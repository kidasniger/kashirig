"""
Usage (Blender 4.x, sans interface) :
  blender -b -P rig_luw.py -- input/luw.glb input/kidas.fbx output/luw_rigged.fbx 40000

Principe :
  1. importe le GLB (luw) et le FBX de référence (Kidas, riggé Mixamo)
  2. met la texture en Base Color (le GLB l'a en Emission)
  3. décime luw à N triangles
  4. aligne Kidas sur luw (hauteur + pieds au sol + centre XY)
  5. transfère les poids Kidas -> luw (plus proche face interpolée)
  6. lie luw à l'armature Kidas, normalise, limite à 4 influences
  7. exporte un FBX avec texture intégrée
"""
import sys
import bpy
from mathutils import Vector


def args():
    a = sys.argv[sys.argv.index("--") + 1:]
    glb, fbx, out = a[0], a[1], a[2]
    tris = int(a[3]) if len(a) > 3 else 40000
    return glb, fbx, out, tris


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def world_bounds(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


def select_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def fix_texture(obj):
    """Branche l'image d'emission sur Base Color si le base color est noir."""
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        img = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None)
        if bsdf and img:
            for l in list(bsdf.inputs["Emission Color"].links):
                nt.links.remove(l)
            nt.links.new(img.outputs["Color"], bsdf.inputs["Base Color"])
            bsdf.inputs["Emission Strength"].default_value = 0.0


def main():
    glb, fbx, out, target_tris = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # --- Import luw
    bpy.ops.import_scene.gltf(filepath=glb)
    luw = max(mesh_objects(), key=lambda o: len(o.data.polygons))
    luw.name = "luw"
    fix_texture(luw)

    # --- Import Kidas (FBX Mixamo)
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=fbx)
    new = [o for o in bpy.context.scene.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    kidas = next(o for o in new if o.type == "MESH")

    # --- Décimation de luw
    select_only(luw)
    bpy.ops.object.modifier_add(type="TRIANGULATE")
    bpy.ops.object.modifier_apply(modifier="Triangulate")
    cur = len(luw.data.polygons)
    if cur > target_tris:
        mod = luw.modifiers.new("Decimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = target_tris / cur
        mod.use_collapse_triangulate = True
        mod.use_symmetry = False
        bpy.ops.object.modifier_apply(modifier=mod.name)
    print("Triangles luw :", len(luw.data.polygons))

    # --- Alignement de Kidas sur luw (échelle uniforme + pieds + centre)
    lmn, lmx = world_bounds(luw)
    kmn, kmx = world_bounds(kidas)
    s = (lmx.z - lmn.z) / (kmx.z - kmn.z)
    # on met à l'échelle le mesh ET l'armature via un parent temporaire
    root = bpy.data.objects.new("tmp_root", None)
    bpy.context.scene.collection.objects.link(root)
    for o in (arm, kidas):
        o.parent = root
    root.scale = (s, s, s)
    bpy.context.view_layer.update()
    kmn, kmx = world_bounds(kidas)
    root.location += Vector((
        (lmn.x + lmx.x) / 2 - (kmn.x + kmx.x) / 2,
        (lmn.y + lmx.y) / 2 - (kmn.y + kmx.y) / 2,
        lmn.z - kmn.z,
    ))
    bpy.context.view_layer.update()

    # --- Transfert des poids
    select_only(luw)
    luw.vertex_groups.clear()
    for vg in kidas.vertex_groups:
        luw.vertex_groups.new(name=vg.name)
    dt = luw.modifiers.new("WeightTransfer", "DATA_TRANSFER")
    dt.object = kidas
    dt.use_vert_data = True
    dt.data_types_verts = {"VGROUP_WEIGHTS"}
    dt.vert_mapping = "POLYINTERP_NEAREST"
    dt.layers_vgroup_select_src = "ALL"
    dt.layers_vgroup_select_dst = "NAME"
    bpy.ops.object.datalayout_transfer(modifier=dt.name)
    bpy.ops.object.modifier_apply(modifier=dt.name)

    # --- Nettoyage des poids
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.objects.active = luw
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)

    # --- Lier luw à l'armature
    arm_mod = luw.modifiers.new("Armature", "ARMATURE")
    arm_mod.object = arm
    luw.parent = arm

    # --- Supprimer le mesh Kidas et le parent temporaire
    bpy.data.objects.remove(kidas, do_unlink=True)
    arm.parent = None
    bpy.data.objects.remove(root, do_unlink=True)
    bpy.context.view_layer.update()

    # --- Export FBX
    bpy.ops.object.select_all(action="DESELECT")
    luw.select_set(True)
    arm.select_set(True)
    bpy.ops.export_scene.fbx(
        filepath=out,
        use_selection=True,
        path_mode="COPY",
        embed_textures=True,
        apply_scale_options="FBX_SCALE_ALL",
        axis_forward="-Z",
        axis_up="Y",
        add_leaf_bones=False,
        bake_anim=False,
    )
    print("Export :", out)


main()
