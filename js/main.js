import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { importFiles } from './loader.js?v=5';
import { createViewer, buildGeometry } from './viewer.js?v=5';
import { orient, autoYaw, normalize, weld, smoothNormals, checkTPose } from './geom.js?v=5';
import { simplify } from './simplify.js?v=5';
import { detectLandmarks } from './landmarks.js?v=5';
import { loadRig, fitSkeleton } from './skeleton.js?v=5';
import { loadSkin, transferWeights } from './weights.js?v=5';
import { buildSkinned, testPose } from './skinned.js?v=5';

window.__booted = true;

const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('fr-FR');
const tick = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

const state = { src: null, base: null, work: null, flip: false, rawHeight: 0, tpose: null, lm: null, rig: null, shoulder: null, showSkel: true, kskin: null, skinned: null };
const viewer = createViewer($('view'));

function status(msg, kind = 'info') {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status ' + kind;
}
window.addEventListener('error', e => status('Erreur : ' + (e.message || e.error), 'err'));
window.addEventListener('unhandledrejection', e => status('Erreur : ' + ((e.reason && e.reason.message) || e.reason), 'err'));

function lock(v) {
  for (const id of ['reduce', 'download', 'flip', 'up', 'target', 'wBuild']) $(id).disabled = v || (!state.base && id !== 'up');
  $('up').disabled = v;
}

function stat(k, v) { return '<div><span>' + k + '</span><b>' + v + '</b></div>'; }

function render() {
  const w = state.work;
  const geom = buildGeometry({ pos: w.pos, uv: w.uv, index: w.index, normals: smoothNormals(w.pos, w.index) });
  viewer.setMesh(geom, state.src.material);
  $('stats').innerHTML =
    stat('Triangles source', fmt(state.src.info.triangles)) +
    stat('Triangles actuels', fmt(w.index.length / 3)) +
    stat('Hauteur source', state.rawHeight.toFixed(2) + ' (→ 1,75 m)') +
    stat('Texture', state.src.material.map ? 'oui' : 'non') +
    stat('Maillages', state.src.info.meshes) +
    stat('Matériaux', state.src.info.materials + (state.src.info.materials > 1 ? ' (1 seul gardé)' : ''));

  const t = state.tpose;
  const m = t.metrics;
  $('tpose').innerHTML =
    '<div class="chip ' + (t.ok ? 'ok' : 'bad') + '">' + (t.ok ? 'T-pose valide' : 'T-pose non valide') + '</div>' +
    '<p class="hint">Largeur ' + m.widthPct + ' % · profondeur ' + m.depthPct + ' %' +
    (m.spreadPct !== null ? ' · bras ' + m.armHeightPct + ' % de haut, écart ' + m.spreadPct + ' %' : '') + '</p>' +
    t.issues.map(i => '<p class="warn">' + i + '</p>').join('') +
    (t.hint ? '<p class="warn">' + t.hint + '</p>' : '');
}

const SL = ['lmHead', 'lmNeck', 'lmCrotch', 'lmHandX', 'lmHandY'];
const COL = { head: 0xff6b6b, neck: 0xe3b341, crotch: 0x4cc2a0, foot: 0x58a6ff, hand: 0xd2a8ff };

function drawMarkers() {
  const p = state.lm && state.lm.pts;
  if (!p) { viewer.setMarkers([]); return; }
  viewer.setMarkers([
    { p: p.headTop, color: COL.head, ring: true },
    { p: p.neck, color: COL.neck, ring: true },
    { p: p.crotch, color: COL.crotch, ring: true },
    { p: p.footP, color: COL.foot }, { p: p.footN, color: COL.foot },
    { p: p.handP, color: COL.hand }, { p: p.handN, color: COL.hand },
  ], [p.headTop, p.neck, p.crotch]);
}

function syncSliders() {
  const p = state.lm.pts;
  const set = (id, v) => { $(id).value = (v * 100).toFixed(1); $(id + 'V').textContent = Math.round(v * 100) + ' cm'; };
  set('lmHead', p.headTop[1]); set('lmNeck', p.neck[1]); set('lmCrotch', p.crotch[1]);
  if (p.handP && p.handN) { set('lmHandX', (Math.abs(p.handP[0]) + Math.abs(p.handN[0])) / 2); set('lmHandY', (p.handP[1] + p.handN[1]) / 2); }
}

function readSliders() {
  clearSkin();
  const p = state.lm.pts, v = id => +$(id).value / 100;
  p.headTop[1] = v('lmHead'); p.neck[1] = v('lmNeck'); p.crotch[1] = v('lmCrotch');
  for (const [h, s] of [[p.handP, 1], [p.handN, -1]]) if (h) { h[0] = s * v('lmHandX'); h[1] = v('lmHandY'); }
  for (const id of SL) $(id + 'V').textContent = Math.round(+$(id).value) + ' cm';
  drawMarkers();
  drawSkeleton();
}

function drawSkeleton() {
  if (!state.rig || !state.lm) return;
  const r = fitSkeleton(state.rig, state.lm, state.shoulder);
  if (!r) { viewer.setSkeleton(null); $('skInfo').textContent = 'Repères incomplets : squelette non posé.'; return; }
  viewer.setSkeleton(state.rig, r.pos);
  viewer.setSkeletonVisible(state.showSkel);
  $('skShoulder').value = (r.shoulderX * 100).toFixed(1);
  $('skShoulderV').textContent = Math.round(r.shoulderX * 100) + ' cm';
  $('skInfo').textContent = state.rig.bones.length + ' os posés sur le modèle.';
}

$('skShoulder').addEventListener('input', () => { clearSkin(); state.shoulder = +$('skShoulder').value / 100; drawSkeleton(); });
$('skToggle').addEventListener('click', e => {
  state.showSkel = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', state.showSkel);
  viewer.setSkeletonVisible(state.showSkel);
});
loadRig('assets/kidas_rig.json?v=5').then(r => { state.rig = r; if (state.lm) drawSkeleton(); })
  .catch(err => status('Squelette indisponible : ' + (err.message || err), 'warn'));

function clearSkin() {
  if (!state.skinned) return;
  state.skinned = null;
  $('wPose').value = 0; $('wPose').disabled = true;
  $('wInfo').textContent = 'Repères modifiés : recalcule les poids.';
  render(); drawMarkers(); drawSkeleton();
}

$('wBuild').addEventListener('click', async () => {
  if (!state.base || !state.rig || !state.lm) return;
  lock(true);
  status('Chargement des poids de Kidas…');
  await tick();
  try {
    if (!state.kskin) state.kskin = await loadSkin('assets/kidas_skin.bin?v=5', state.rig.skinN);
    const fitRes = fitSkeleton(state.rig, state.lm, state.shoulder);
    if (!fitRes) throw new Error('Repères incomplets.');
    status('Transfert des poids…');
    await tick();
    const t0 = performance.now();
    const w = state.work;
    const res = transferWeights(state.kskin, state.rig, fitRes.fit, w.pos);
    const geom = buildGeometry({ pos: w.pos, uv: w.uv, index: w.index, normals: smoothNormals(w.pos, w.index) });
    geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(res.skinIndex, 4));
    geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(res.skinWeight, 4));
    const sk = buildSkinned(state.rig, fitRes.pos, geom, state.src.material);
    sk.mesh.name = state.src.name;
    state.skinned = sk;
    viewer.setObject(sk.mesh);
    viewer.setSkeletonVisible(false);
    viewer.setMarkers([]);
    $('wPose').value = 0; $('wPose').disabled = false;
    $('wInfo').textContent = fmt(w.pos.length / 3) + ' sommets, 4 influences max' + (res.far ? ' (' + res.far + ' sans voisin : liés au bassin)' : '') + '.';
    status('Poids transférés en ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s. Bouge le curseur de pose pour vérifier.', 'ok');
  } catch (err) {
    console.error(err);
    status('Erreur de poids : ' + (err.message || err), 'err');
  }
  lock(false);
});

$('wPose').addEventListener('input', () => {
  if (state.skinned) testPose(state.skinned.bones, state.rig, +$('wPose').value / 100);
});

function detect() {
  state.lm = detectLandmarks(state.base.pos);
  state.lmAuto = JSON.parse(JSON.stringify(state.lm.pts));
  syncSliders();
  drawMarkers();
  state.shoulder = null;
  drawSkeleton();
  const l = state.lm;
  $('lmInfo').textContent = 'Détection automatique' + (l.crotchFound ? '' : ' (entrejambe estimé, à vérifier)') +
    ' · face orientée comme Kidas.';
}

for (const id of SL) $(id).addEventListener('input', () => { if (state.lm) readSliders(); });
$('lmReset').addEventListener('click', () => { if (state.base) { clearSkin(); detect(); } });

async function prepare() {
  state.skinned = null; $('wPose').disabled = true; $('wPose').value = 0; $('wInfo').textContent = '';
  const s = state.src;
  const pos = Float32Array.from(s.pos);
  orient(pos, $('up').value, false);
  state.yawed = autoYaw(pos);
  state.rawHeight = normalize(pos).rawHeight;
  await tick();
  const base = weld(pos, s.uv, s.index);
  state.base = base;
  state.work = base;
  // Oriente le modèle face à +Z (comme Kidas) ; « Tourner de 180° » inverse ce choix.
  const want = state.flip ? -1 : 1;
  if (detectLandmarks(base.pos).front !== want) {
    for (let i = 0; i < base.pos.length; i += 3) { base.pos[i] = -base.pos[i]; base.pos[i + 2] = -base.pos[i + 2]; }
  }
  state.tpose = checkTPose(base.pos);
  render();
  detect();
  lock(false);
  const t = state.tpose;
  status(t.ok ? 'Modèle prêt (' + fmt(base.index.length / 3) + ' triangles, T-pose OK' + (state.yawed ? ', tourné de 90° automatiquement' : '') + ').'
              : 'Modèle chargé, mais la T-pose n\'est pas valide : voir étape 2.', t.ok ? 'ok' : 'warn');
}

$('file').addEventListener('change', async e => {
  const files = e.target.files;
  if (!files || !files.length) return;
  lock(true);
  status('Lecture du fichier…');
  await tick();
  try {
    state.flip = false;
    state.src = await importFiles(files);
    await prepare();
  } catch (err) {
    console.error(err);
    status('Erreur à l\'import : ' + (err.message || err), 'err');
    lock(false);
  } finally {
    e.target.value = '';
  }
});

$('up').addEventListener('change', async () => { if (state.src) { lock(true); await prepare(); } });
$('flip').addEventListener('click', async () => { if (state.src) { state.flip = !state.flip; lock(true); await prepare(); } });

$('target').addEventListener('input', () => { $('targetVal').textContent = fmt(+$('target').value); });
$('targetVal').textContent = fmt(+$('target').value);

$('reduce').addEventListener('click', async () => {
  if (!state.base) return;
  const target = +$('target').value;
  lock(true);
  status('Réduction en cours…');
  await tick();
  try {
    const r = await simplify(state.base, target);
    state.work = { pos: r.pos, uv: r.uv, index: r.index };
    state.skinned = null; $('wPose').disabled = true; $('wPose').value = 0; $('wInfo').textContent = '';
    render();
    drawMarkers();
    drawSkeleton();
    status(r.after === r.before
      ? 'Déjà sous la cible (' + fmt(r.before) + ' triangles), rien à réduire.'
      : 'Réduit : ' + fmt(r.before) + ' → ' + fmt(r.after) + ' triangles' + (r.usedUV ? ' (UV préservées).' : ' (sans pondération UV).'), 'ok');
  } catch (err) {
    console.error(err);
    status('Erreur de réduction : ' + (err.message || err), 'err');
  }
  lock(false);
});

$('wire').addEventListener('click', e => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', on);
  viewer.setWireframe(on);
});

$('kidas').addEventListener('click', async e => {
  const btn = e.currentTarget;
  const on = btn.getAttribute('aria-pressed') !== 'true';
  if (!on) { viewer.hideKidas(); btn.setAttribute('aria-pressed', false); return; }
  status('Chargement de Kidas…');
  try {
    const info = await viewer.showKidas('assets/kidas.fbx');
    btn.setAttribute('aria-pressed', true);
    status('Kidas affiché : ' + info.bones + ' os' + (info.hips ? ' (Hips trouvé).' : ' (Hips introuvable).'), info.bones === 65 ? 'ok' : 'warn');
  } catch (err) {
    status(err.message || String(err), 'err');
  }
});

$('download').addEventListener('click', () => {
  if (!state.work) return;
  const w = state.work;
  let mesh;
  if (state.skinned) {
    testPose(state.skinned.bones, state.rig, 0);
    $('wPose').value = 0;
    mesh = state.skinned.mesh;
  } else {
    mesh = new THREE.Mesh(
      buildGeometry({ pos: w.pos, uv: w.uv, index: w.index, normals: smoothNormals(w.pos, w.index) }),
      state.src.material);
    mesh.name = state.src.name;
  }
  const wasWire = state.src.material.wireframe;
  state.src.material.wireframe = false;
  status('Export GLB…');
  new GLTFExporter().parse(mesh, result => {
    state.src.material.wireframe = wasWire;
    const blob = new Blob([result], { type: 'model/gltf-binary' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = state.src.name + '_' + Math.round(w.index.length / 3) + 'tri' + (state.skinned ? '_rig' : '') + '.glb';
    document.body.appendChild(a);
    a.click();
    a.remove();
    status('GLB exporté (' + (blob.size / 1048576).toFixed(1) + ' Mo).', 'ok');
  }, err => {
    state.src.material.wireframe = wasWire;
    status('Erreur d\'export : ' + (err.message || err), 'err');
  }, { binary: true });
});

lock(true);
$('up').disabled = false;
status('Prêt. Importe un modèle (étape 1).');
