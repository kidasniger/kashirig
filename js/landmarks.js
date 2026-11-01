// Détection automatique des repères du corps (fonctions pures, sans dépendance).
// Entrée : positions (x,y,z) déjà orientées et normalisées : pieds à y = 0, centré,
// bras portés par l'axe X (T-pose). Sortie en mètres.

function pct(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))]; }

export function detectLandmarks(pos) {
  let H = 0;
  for (let i = 1; i < pos.length; i += 3) if (pos[i] > H) H = pos[i];
  const n = pos.length / 3;

  // Sommet de la tête
  const headTop = H;

  // Profils par tranche de 1 cm, sur le tronc central (|x| < 0,11 m)
  const BIN = 0.01, NB = Math.ceil(H / BIN) + 1;
  const xs = Array.from({ length: NB }, () => []), zs = Array.from({ length: NB }, () => []);
  const CX = 0.11;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i];
    if (Math.abs(x) > CX) continue;
    const b = Math.floor(pos[i + 1] / BIN);
    xs[b].push(x); zs[b].push(pos[i + 2]);
  }
  const ext = a => { if (a.length < 20) return null; a.sort(); return pct(a, 0.95) - pct(a, 0.05); };

  // Cou : minimum de largeur (x + z) entre 80 % et 92 % de la taille
  const prof = [];
  for (let b = 0; b < NB; b++) {
    const ex = ext(xs[b]), ez = ext(zs[b]);
    prof.push(ex === null || ez === null ? null : ex + ez);
  }
  let neck = 0.855 * H, best = Infinity;
  const b0 = Math.floor(0.80 * H / BIN), b1 = Math.floor(0.92 * H / BIN);
  for (let b = b0 + 1; b < b1; b++) {
    const w = [prof[b - 1], prof[b], prof[b + 1]];
    if (w.some(v => v === null)) continue;
    const s = (w[0] + w[1] + w[2]) / 3;
    if (s < best) { best = s; neck = (b + 0.5) * BIN; }
  }

  // Entrejambe : plus haut point où le couloir central |x| < 1,2 cm est vide
  let crotch = 0.47 * H, found = false;
  const strip = new Uint32Array(NB);
  for (let i = 0; i < pos.length; i += 3) {
    if (Math.abs(pos[i]) < 0.012) strip[Math.floor(pos[i + 1] / BIN)]++;
  }
  for (let b = Math.floor(0.55 * H / BIN); b >= Math.floor(0.35 * H / BIN); b--) {
    if (strip[b] < 3 && strip[b - 1] < 3) { crotch = (b + 1) * BIN; found = true; break; }
  }

  // Pieds : points bas (y < 6 cm), séparés selon le signe de x
  const feet = { p: { sx: 0, sz: 0, c: 0, zmin: Infinity, zmax: -Infinity, sy: 0 }, n: { sx: 0, sz: 0, c: 0, zmin: Infinity, zmax: -Infinity, sy: 0 } };
  let az = 0, ac = 0;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i + 1] >= 0.09 && pos[i + 1] <= 0.15) { az += pos[i + 2]; ac++; }
    if (pos[i + 1] > 0.06) continue;
    const f = pos[i] >= 0 ? feet.p : feet.n;
    f.sx += pos[i]; f.sz += pos[i + 2]; f.c++;
    if (pos[i + 2] < f.zmin) f.zmin = pos[i + 2];
    if (pos[i + 2] > f.zmax) f.zmax = pos[i + 2];
  }
  // Le pied dépasse davantage vers l'avant que vers l'arrière de la cheville.
  const zank = ac ? az / ac : 0;
  const zmin = Math.min(feet.p.zmin, feet.n.zmin), zmax = Math.max(feet.p.zmax, feet.n.zmax);
  const front = (zmax - zank) >= (zank - zmin) ? 1 : -1;
  const foot = f => f.c ? [f.sx / f.c, 0.02, front > 0 ? f.zmax : f.zmin] : null;

  // Bout des mains : extrémités en X, sur une profondeur de 3 cm
  function hand(s) {
    let m = 0;
    for (let i = 0; i < pos.length; i += 3) { const v = s * pos[i]; if (v > m) m = v; }
    let sy = 0, sz = 0, c = 0;
    for (let i = 0; i < pos.length; i += 3) {
      if (s * pos[i] > m - 0.03) { sy += pos[i + 1]; sz += pos[i + 2]; c++; }
    }
    return c ? [s * m, sy / c, sz / c] : null;
  }

  return {
    height: H, front, crotchFound: found, n,
    pts: {
      headTop: [0, headTop, 0],
      neck: [0, neck, 0],
      crotch: [0, crotch, 0],
      footP: foot(feet.p), footN: foot(feet.n),
      handP: hand(1), handN: hand(-1),
    },
  };
}
