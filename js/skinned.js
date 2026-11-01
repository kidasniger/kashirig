// Construction du SkinnedMesh (os Kidas recalés) et pose de test.
import * as THREE from 'three';

// rig : kidas_rig.json ; pos : positions recalées des os ; geometry : avec skinIndex / skinWeight.
export function buildSkinned(rig, pos, geometry, material) {
  const W = rig.bones.map((b, i) => new THREE.Matrix4().compose(
    new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]),
    new THREE.Quaternion(b.q[0], b.q[1], b.q[2], b.q[3]),
    new THREE.Vector3(1, 1, 1)));
  const bones = rig.bones.map(b => { const o = new THREE.Bone(); o.name = b.n; return o; });
  rig.bones.forEach((b, i) => {
    const L = b.p < 0 ? W[i].clone() : W[b.p].clone().invert().multiply(W[i]);
    L.decompose(bones[i].position, bones[i].quaternion, bones[i].scale);
    bones[i].userData.q0 = bones[i].quaternion.clone();
    bones[i].userData.p0 = bones[i].position.clone();
    if (b.p >= 0) bones[b.p].add(bones[i]);
  });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.add(bones[0]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  return { mesh, bones };
}

function rotateWorld(bones, rig, name, axis, angle) {
  const i = rig.bones.findIndex(b => b.n === 'mixamorig:' + name);
  const bone = bones[i];
  bone.parent.updateWorldMatrix(true, false);
  const pq = new THREE.Quaternion();
  bone.parent.getWorldQuaternion(pq);
  const d = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  bone.quaternion.copy(pq.clone().invert().multiply(d).multiply(pq).multiply(bone.userData.q0));
}

// a de 0 à 1 : lève le bras gauche (80°) et la jambe droite vers l'avant (50°).
export function testPose(bones, rig, a) {
  for (const b of bones) { b.quaternion.copy(b.userData.q0); b.position.copy(b.userData.p0); }
  if (a <= 0) return;
  rotateWorld(bones, rig, 'LeftArm', new THREE.Vector3(0, 0, 1), a * 80 * Math.PI / 180);
  rotateWorld(bones, rig, 'RightUpLeg', new THREE.Vector3(1, 0, 0), -a * 50 * Math.PI / 180);
}
