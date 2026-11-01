// Transfert des poids de peau de Kidas vers le modèle (fonctions pures).
// 1) les sommets de Kidas sont déplacés dans l'espace du modèle (même recalage que le squelette) ;
// 2) chaque sommet du modèle reprend les poids de ses 4 voisins les plus proches ;
// 3) on garde 4 influences au maximum, normalisées.

export async function loadSkin(url, n) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Impossible de charger ' + url);
  return parseSkin(await r.arrayBuffer(), n);
}

export function parseSkin(buf, n) {
  return {
    n,
    pos: new Float32Array(buf, 0, n * 3),
    joints: new Uint8Array(buf, n * 12, n * 4),
    weights: new Uint8Array(buf, n * 16, n * 4),
  };
}

const CELL = 0.03;
const key = (ix, iy, iz) => ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512);

export function transferWeights(skin, rig, fit, target) {
  const n = skin.n;
  // 1) Kidas -> espace du modèle (la classe du recalage vient de l'os dominant du sommet)
  const kp = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const name = rig.bones[skin.joints[v * 4]].n.replace('mixamorig:', '');
    const r = fit.map([skin.pos[v * 3], skin.pos[v * 3 + 1], skin.pos[v * 3 + 2]], name);
    kp[v * 3] = r[0]; kp[v * 3 + 1] = r[1]; kp[v * 3 + 2] = r[2];
  }
  // grille spatiale
  const grid = new Map();
  for (let v = 0; v < n; v++) {
    const k = key(Math.floor(kp[v * 3] / CELL), Math.floor(kp[v * 3 + 1] / CELL), Math.floor(kp[v * 3 + 2] / CELL));
    const a = grid.get(k);
    if (a) a.push(v); else grid.set(k, [v]);
  }
  // 2) voisins les plus proches
  const m = target.length / 3;
  const skinIndex = new Uint16Array(m * 4), skinWeight = new Float32Array(m * 4);
  const nd = new Float64Array(4), ni = new Int32Array(4);
  const jb = new Int32Array(20), jw = new Float64Array(20);
  let far = 0;
  for (let i = 0; i < m; i++) {
    const x = target[i * 3], y = target[i * 3 + 1], z = target[i * 3 + 2];
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), cz = Math.floor(z / CELL);
    nd.fill(Infinity); ni.fill(-1);
    for (let r = 1; r <= 8; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue; // couche r seulement
        const a = grid.get(key(cx + dx, cy + dy, cz + dz));
        if (!a) continue;
        for (const v of a) {
          const ex = kp[v * 3] - x, ey = kp[v * 3 + 1] - y, ez = kp[v * 3 + 2] - z;
          const d = ex * ex + ey * ey + ez * ez;
          if (d < nd[3]) {
            let k = 3;
            while (k > 0 && nd[k - 1] > d) { nd[k] = nd[k - 1]; ni[k] = ni[k - 1]; k--; }
            nd[k] = d; ni[k] = v;
          }
        }
      }
      // une couche de plus après avoir 4 voisins, pour ne pas rater un voisin plus proche
      if (ni[3] >= 0 && Math.sqrt(nd[3]) <= (r) * CELL) break;
    }
    let cnt = 0;
    for (let q = 0; q < 4; q++) {
      const v = ni[q];
      if (v < 0) continue;
      const wq = 1 / (nd[q] + 1e-6);
      for (let k = 0; k < 4; k++) {
        const w = skin.weights[v * 4 + k];
        if (!w) continue;
        const b = skin.joints[v * 4 + k];
        let s = 0;
        while (s < cnt && jb[s] !== b) s++;
        if (s === cnt) { jb[cnt] = b; jw[cnt] = 0; cnt++; }
        jw[s] += wq * w;
      }
    }
    if (cnt === 0) { skinIndex[i * 4] = 0; skinWeight[i * 4] = 1; far++; continue; }
    // 4 plus gros poids
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      let best = -1, bw = 0;
      for (let s = 0; s < cnt; s++) if (jw[s] > bw) { bw = jw[s]; best = s; }
      if (best < 0) break;
      skinIndex[i * 4 + k] = jb[best]; skinWeight[i * 4 + k] = bw; sum += bw; jw[best] = 0;
    }
    for (let k = 0; k < 4; k++) skinWeight[i * 4 + k] /= sum;
  }
  return { skinIndex, skinWeight, far };
}
