"""
Usage (Blender 4.x, sans interface) :
  blender -b --python-exit-code 1 -P blender/rig_luw.py -- input/luw.glb assets/kidas.fbx output/luw_rigged.fbx 40000

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
from mathutils import Vector, Matrix


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


def is_descendant(obj, ancestor):
    while obj.parent:
        obj = obj.parent
        if obj == ancestor:
            return True
    return False


def bake_world(obj):
    """Détache l'objet de son parent en gardant sa position dans le monde."""
    mw = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = mw


def fix_texture(obj):
    """Branche l'image d'émission sur Base Color (le base color du GLB est noir)."""
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        img = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None)
        if not (bsdf and img):
            continue
        emi = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        if emi is not None:
            for l in list(emi.links):
                nt.links.remove(l)
        strength = bsdf.inputs.get("Emission Strength")
        if strength is not None:
            strength.default_value = 0.0
        bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        nt.links.new(img.outputs["Color"], bsdf.inputs["Base Color"])
        print("Texture branchée sur Base Color :", mat.name)


def main():
    glb, fbx, out, target_tris = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # --- Import luw
    bpy.ops.import_scene.gltf(filepath=glb)
    meshes = mesh_objects()
    if not meshes:
        raise RuntimeError("Aucun mesh dans le GLB")
    luw = max(meshes, key=lambda o: len(o.data.polygons))
    luw.name = "luw"
    print("Meshes dans le GLB :", len(meshes), "| triangles avant :", len(luw.data.polygons))
    bake_world(luw)
    if luw.data.users > 1:
        luw.data = luw.data.copy()
    select_only(luw)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    fix_texture(luw)

    # --- Import Kidas (FBX Mixamo)
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=fbx)
    new = [o for o in bpy.context.scene.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    kmeshes = [o for o in new if o.type == "MESH"]
    kidas = max(kmeshes, key=lambda o: len(o.data.polygons))
    for o in kmeshes:
        if o is not kidas:
            bpy.data.objects.remove(o, do_unlink=True)
    print("Os Kidas :", len(arm.data.bones), "| groupes de poids :", len(kidas.vertex_groups))

    # Kidas en pose de repos, sans animation
    arm.animation_data_clear()
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)
    arm.data.pose_position = "REST"

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

    # --- Alignement de Kidas sur luw (échelle uniforme + pieds + centre XY)
    # On transforme l'armature (le mesh Kidas, enfant, suit). Si Kidas n'est pas enfant, on le transforme aussi.
    roots = [arm] + ([] if is_descendant(kidas, arm) else [kidas])
    lmn, lmx = world_bounds(luw)
    kmn, kmx = world_bounds(kidas)
    s = (lmx.z - lmn.z) / (kmx.z - kmn.z)
    for r in roots:
        r.matrix_world = Matrix.Scale(s, 4) @ r.matrix_world
    bpy.context.view_layer.update()
    kmn, kmx = world_bounds(kidas)
    off = Vector((
        (lmn.x + lmx.x) / 2 - (kmn.x + kmx.x) / 2,
        (lmn.y + lmx.y) / 2 - (kmn.y + kmx.y) / 2,
        lmn.z - kmn.z,
    ))
    for r in roots:
        r.matrix_world = Matrix.Translation(off) @ r.matrix_world
    bpy.context.view_layer.update()
    print("Échelle Kidas :", round(s, 4), "| décalage :", tuple(round(v, 4) for v in off))

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
    bpy.context.view_layer.objects.active = luw
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    weighted = sum(1 for v in luw.data.vertices if len(v.groups) > 0)
    print("Sommets avec poids :", weighted, "/", len(luw.data.vertices))
    if weighted == 0:
        raise RuntimeError("Aucun poids transféré : alignement Kidas/luw à vérifier")

    # --- Lier luw à l'armature (sans bouger luw dans le monde)
    arm_mod = luw.modifiers.new("Armature", "ARMATURE")
    arm_mod.object = arm
    luw.parent = arm
    luw.matrix_parent_inverse = arm.matrix_world.inverted()
    arm.data.pose_position = "POSE"

    # --- Supprimer le mesh Kidas
    bpy.data.objects.remove(kidas, do_unlink=True)
    bpy.context.view_layer.update()

    # --- Export FBX
    bpy.ops.object.select_all(action="DESELECT")
    luw.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.fbx(
        filepath=out,
        use_selection=True,
        object_types={"ARMATURE", "MESH"},
        path_mode="COPY",
        embed_textures=True,
        apply_scale_options="FBX_SCALE_ALL",
        axis_forward="-Z",
        axis_up="Y",
        add_leaf_bones=False,
        mesh_smooth_type="FACE",
        bake_anim=False,
    )
    print("Export :", out)


main()
