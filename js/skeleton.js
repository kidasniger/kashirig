// Recalage du squelette Kidas (65 os Mixamo) sur les repères du modèle.
// On ne déplace que les positions : les orientations des os restent celles de Kidas.
// Repère : Y vers le haut, face vers +Z, côté gauche du personnage = +X.

export async function loadRig(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Impossible de charger ' + url);
  return r.json();
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);

// lm : résultat de detectLandmarks ({ pts, zc }) ; shoulderX : demi-écart des épaules (m) ou null.
export function fitSkeleton(rig, lm, shoulderX = null) {
  const K = rig.lm, P = lm.pts;
  if (!P.handP || !P.handN || !P.footP || !P.footN) return null;
  const T = { headTop: P.headTop[1], neck: P.neck[1], crotch: P.crotch[1] };
  const kx = [0, K.crotch, K.neck, K.headTop], tx = [0, T.crotch, T.neck, T.headTop];
  // Hauteur : linéaire par morceaux (sol, entrejambe, cou, sommet de la tête).
  const f = y => {
    const i = y <= kx[1] ? 0 : y <= kx[2] ? 1 : 2;
    return tx[i] + (y - kx[i]) * (tx[i + 1] - tx[i]) / (kx[i + 1] - kx[i]);
  };
  const zc = lm.zc || 0;
  const zbody = z => zc + (z - K.zc);

  const byName = {};
  rig.bones.forEach((b, i) => { byName[b.n.replace('mixamorig:', '')] = i; });
  const kArm = rig.bones[byName.LeftArm].pos;
  const kFoot = rig.bones[byName.LeftFoot].pos;

  const handAvg = (Math.abs(P.handP[0]) + Math.abs(P.handN[0])) / 2;
  const defShoulder = kArm[0] * handAvg / K.handP[0];
  const shx = shoulderX == null ? defShoulder : shoulderX;
  const kSh = [kArm[0], kArm[1], kArm[2]];
  const tShBase = [shx, f(kArm[1]), zbody(kArm[2])];
  const kTip = [K.handP[0], K.handP[1], K.handP[2]];
  const kd = sub(kTip, kSh), kd2 = dot(kd, kd);

  const out = new Float32Array(rig.bones.length * 3);
  rig.bones.forEach((b, i) => {
    const name = b.n.replace('mixamorig:', '');
    const [x, y, z] = b.pos;
    const side = x >= 0 ? 1 : -1;
    let r;
    if (/Arm|Hand/.test(name)) {
      const hp = side > 0 ? P.handP : P.handN;
      const tTip = [Math.abs(hp[0]), hp[1], hp[2]];
      const td = sub(tTip, tShBase);
      const s = len(td) / len(kd);
      const q = sub([Math.abs(x), y, z], kSh);
      const t = dot(q, kd) / kd2;
      const perp = [q[0] - t * kd[0], q[1] - t * kd[1], q[2] - t * kd[2]];
      r = [
        side * (tShBase[0] + t * td[0] + s * perp[0]),
        tShBase[1] + t * td[1] + s * perp[1],
        tShBase[2] + t * td[2] + s * perp[2],
      ];
    } else if (/Leg|Foot|Toe/.test(name)) {
      const ft = side > 0 ? P.footP : P.footN;
      const lx = Math.abs(ft[0]) / K.footP[0];
      let zz = zbody(z);
      if (/Toe/.test(name)) {
        const zAnkleT = zbody(kFoot[2]);
        const sf = (ft[2] - zAnkleT) / (K.footP[2] - kFoot[2]);
        zz = zAnkleT + (z - kFoot[2]) * sf;
      }
      r = [x * lx, f(y), zz];
    } else {
      r = [x * shx / kArm[0], f(y), zbody(z)];
    }
    out[i * 3] = r[0]; out[i * 3 + 1] = r[1]; out[i * 3 + 2] = r[2];
  });
  return { pos: out, shoulderX: shx, defaultShoulderX: defShoulder };
}
