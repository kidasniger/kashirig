// Fonctions pures (aucune dépendance) : orientation, échelle, soudure,
// compactage, normales lissées et contrôle de T-pose.

export const TARGET_HEIGHT = 1.75; // hauteur de Kidas (m)

export function bounds(pos) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

// up = 'Y' (défaut) ou 'Z' (Z vers le haut -> Y vers le haut). flip = demi-tour autour de Y.
export function orient(pos, up = 'Y', flip = false) {
  for (let i = 0; i < pos.length; i += 3) {
    let x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (up === 'Z') { const t = y; y = z; z = -t; }
    if (flip) { x = -x; z = -z; }
    pos[i] = x; pos[i + 1] = y; pos[i + 2] = z;
  }
}

// Si les bras sont portés par l'axe Z (modèle tourné de 90°), pivote autour de Y
// pour les ramener sur X. Retourne true si une rotation a été faite.
export function autoYaw(pos) {
  const b = bounds(pos);
  const W = b.maxX - b.minX, D = b.maxZ - b.minZ;
  if (D <= W * 1.3) return false;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], z = pos[i + 2];
    pos[i] = z; pos[i + 2] = -x;
  }
  return true;
}

// Met à l'échelle (hauteur = targetH), pieds à y = 0, centré en x et z.
export function normalize(pos, targetH = TARGET_HEIGHT) {
  const b = bounds(pos);
  const rawHeight = b.maxY - b.minY;
  const s = rawHeight > 0 ? targetH / rawHeight : 1;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = (pos[i] - cx) * s;
    pos[i + 1] = (pos[i + 1] - b.minY) * s;
    pos[i + 2] = (pos[i + 2] - cz) * s;
  }
  return { rawHeight, scale: s };
}

// Soude les sommets identiques (position + UV). index peut être null (géométrie non indexée).
export function weld(pos, uv, index, q = 1e4) {
  const n = pos.length / 3;
  const idxIn = index || (() => { const a = new Uint32Array(n - (n % 3)); for (let i = 0; i < a.length; i++) a[i] = i; return a; })();
  const remap = new Uint32Array(n);
  const first = [];
  const map = new Map();
  for (let i = 0; i < n; i++) {
    let key = Math.round(pos[3 * i] * q) + '_' + Math.round(pos[3 * i + 1] * q) + '_' + Math.round(pos[3 * i + 2] * q);
    if (uv) key += '_' + Math.round(uv[2 * i] * q) + '_' + Math.round(uv[2 * i + 1] * q);
    let j = map.get(key);
    if (j === undefined) { j = first.length; first.push(i); map.set(key, j); }
    remap[i] = j;
  }
  const m = first.length;
  const outPos = new Float32Array(m * 3);
  const outUv = uv ? new Float32Array(m * 2) : null;
  for (let j = 0; j < m; j++) {
    const i = first[j];
    outPos[3 * j] = pos[3 * i]; outPos[3 * j + 1] = pos[3 * i + 1]; outPos[3 * j + 2] = pos[3 * i + 2];
    if (uv) { outUv[2 * j] = uv[2 * i]; outUv[2 * j + 1] = uv[2 * i + 1]; }
  }
  const tmp = new Uint32Array(idxIn.length);
  let k = 0;
  for (let t = 0; t < idxIn.length; t += 3) {
    const a = remap[idxIn[t]], b = remap[idxIn[t + 1]], c = remap[idxIn[t + 2]];
    if (a === b || b === c || a === c) continue; // triangle dégénéré
    tmp[k++] = a; tmp[k++] = b; tmp[k++] = c;
  }
  return { pos: outPos, uv: outUv, index: tmp.slice(0, k) };
}

// Ne garde que les sommets utilisés par l'index.
export function compact(pos, uv, index) {
  const n = pos.length / 3;
  const map = new Int32Array(n).fill(-1);
  let c = 0;
  for (let i = 0; i < index.length; i++) if (map[index[i]] < 0) map[index[i]] = c++;
  const outPos = new Float32Array(c * 3);
  const outUv = uv ? new Float32Array(c * 2) : null;
  for (let i = 0; i < n; i++) {
    const j = map[i];
    if (j < 0) continue;
    outPos[3 * j] = pos[3 * i]; outPos[3 * j + 1] = pos[3 * i + 1]; outPos[3 * j + 2] = pos[3 * i + 2];
    if (uv) { outUv[2 * j] = uv[2 * i]; outUv[2 * j + 1] = uv[2 * i + 1]; }
  }
  const outIdx = new Uint32Array(index.length);
  for (let i = 0; i < index.length; i++) outIdx[i] = map[index[i]];
  return { pos: outPos, uv: outUv, index: outIdx };
}

// Normales lissées, identiques pour tous les sommets à la même position (pas de couture aux limites UV).
export function smoothNormals(pos, index) {
  const n = pos.length / 3;
  const q = 1e4;
  const rep = new Uint32Array(n);
  const map = new Map();
  for (let i = 0; i < n; i++) {
    const key = Math.round(pos[3 * i] * q) + '_' + Math.round(pos[3 * i + 1] * q) + '_' + Math.round(pos[3 * i + 2] * q);
    let r = map.get(key);
    if (r === undefined) { r = i; map.set(key, i); }
    rep[i] = r;
  }
  const acc = new Float32Array(n * 3);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2];
    const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; // pondéré par l'aire
    for (const v of [a, b, c]) {
      const r = rep[v];
      acc[3 * r] += nx; acc[3 * r + 1] += ny; acc[3 * r + 2] += nz;
    }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = rep[i];
    const x = acc[3 * r], y = acc[3 * r + 1], z = acc[3 * r + 2];
    const l = Math.hypot(x, y, z) || 1;
    out[3 * i] = x / l; out[3 * i + 1] = y / l; out[3 * i + 2] = z / l;
  }
  return out;
}

// Contrôle de T-pose sur des positions Y vers le haut.
export function checkTPose(pos) {
  const b = bounds(pos);
  const H = b.maxY - b.minY, W = b.maxX - b.minX, D = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2;
  const ys = [];
  for (let i = 0; i < pos.length; i += 3) {
    if (Math.abs(pos[i] - cx) > 0.25 * H) ys.push(pos[i + 1]);
  }
  const issues = [];
  let spread = null, armH = null;
  if (ys.length < 30) {
    issues.push('Bras non écartés : la largeur est de ' + Math.round((W / H) * 100) + ' % de la taille (T-pose : 65 % ou plus).');
  } else {
    const a = Float32Array.from(ys).sort();
    const p5 = a[Math.floor(a.length * 0.05)], p95 = a[Math.floor(a.length * 0.95)];
    spread = (p95 - p5) / H;
    let mean = 0;
    for (const y of a) mean += y;
    mean /= a.length;
    armH = (mean - b.minY) / H;
    if (spread > 0.14) issues.push('Bras pas à l\'horizontale (écart vertical ' + Math.round(spread * 100) + ' %, max 14 %) : pose en A ou bras relevés.');
    if (armH < 0.68) issues.push('Bras trop bas (' + Math.round(armH * 100) + ' % de la taille, attendu 68 à 92 %).');
    if (armH > 0.92) issues.push('Bras trop hauts (' + Math.round(armH * 100) + ' % de la taille, attendu 68 à 92 %).');
  }
  if (W / H < 0.65 && ys.length >= 30) issues.push('Largeur faible : ' + Math.round((W / H) * 100) + ' % de la taille.');
  let hint = '';
  if (D > 0.8 * H && D > W) hint = 'La profondeur est très grande : l\'axe haut est peut-être Z.';
  else if (H < 0.5 * W) hint = 'Le modèle est plus large que haut : vérifie l\'axe haut.';
  return {
    ok: issues.length === 0,
    issues,
    hint,
    metrics: {
      widthPct: Math.round((W / H) * 100),
      depthPct: Math.round((D / H) * 100),
      spreadPct: spread === null ? null : Math.round(spread * 100),
      armHeightPct: armH === null ? null : Math.round(armH * 100),
    },
  };
}
