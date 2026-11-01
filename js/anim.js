// Animations Mixamo « sans skin » : chargement et adaptation au squelette recalé.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// source : URL (string) ou ArrayBuffer d'un FBX Mixamo sans skin.
export async function loadClip(source) {
  const loader = new FBXLoader();
  const fbx = typeof source === 'string' ? await loader.loadAsync(source) : loader.parse(source, '');
  const clip = fbx.animations && fbx.animations[0];
  if (!clip) throw new Error('Aucune animation dans ce fichier.');
  let hipsY = null;
  fbx.traverse(o => { if (hipsY === null && /Hips$/.test(o.name)) hipsY = o.position.y; });
  return { clip, hipsY };
}

// Les os de Kidas ont les mêmes axes locaux que ceux des animations Mixamo (sauf les doigts, sans conséquence) :
// les rotations sont reprises telles quelles. Seul le déplacement du bassin est mis à l'échelle du modèle.
export function makeClip(src, rig, bones, inPlace = true) {
  const byName = {};
  rig.bones.forEach((b, i) => { byName[b.n.replace('mixamorig:', '')] = bones[i]; });
  const hips = bones[0];
  const rest = hips.userData.p0 || hips.position;
  const s = src.hipsY ? rest.y / src.hipsY : 1;
  const tracks = [];
  for (const t of src.clip.tracks) {
    const m = /^mixamorig\d*:?(.+)\.(quaternion|position)$/.exec(t.name);
    if (!m) continue;
    const bone = byName[m[1]];
    if (!bone) continue;
    if (m[2] === 'quaternion') {
      tracks.push(new THREE.QuaternionKeyframeTrack(bone.uuid + '.quaternion', t.times, t.values));
    } else if (bone === hips) {
      const v = Float32Array.from(t.values);
      const x0 = v[0], z0 = v[2];
      for (let i = 0; i < v.length; i += 3) {
        const x = v[i], y = v[i + 1], z = v[i + 2];
        v[i] = rest.x + (inPlace ? 0 : (x - x0) * s);
        v[i + 1] = y * s;
        v[i + 2] = rest.z + (inPlace ? 0 : (z - z0) * s);
      }
      tracks.push(new THREE.VectorKeyframeTrack(bone.uuid + '.position', t.times, v));
    }
  }
  return new THREE.AnimationClip(src.clip.name, src.clip.duration, tracks);
}
