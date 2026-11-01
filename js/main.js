import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { importFiles } from './loader.js';
import { createViewer, buildGeometry } from './viewer.js';
import { orient, normalize, weld, smoothNormals, checkTPose } from './geom.js';
import { simplify } from './simplify.js';

window.__booted = true;

const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('fr-FR');
const tick = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

const state = { src: null, base: null, work: null, flip: false, rawHeight: 0, tpose: null };
const viewer = createViewer($('view'));

function status(msg, kind = 'info') {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status ' + kind;
}
window.addEventListener('error', e => status('Erreur : ' + (e.message || e.error), 'err'));
window.addEventListener('unhandledrejection', e => status('Erreur : ' + ((e.reason && e.reason.message) || e.reason), 'err'));

function lock(v) {
  for (const id of ['reduce', 'download', 'flip', 'up', 'target']) $(id).disabled = v || (!state.base && id !== 'up');
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

async function prepare() {
  const s = state.src;
  const pos = Float32Array.from(s.pos);
  orient(pos, $('up').value, state.flip);
  state.rawHeight = normalize(pos).rawHeight;
  await tick();
  const base = weld(pos, s.uv, s.index);
  state.base = base;
  state.work = base;
  state.tpose = checkTPose(base.pos);
  render();
  lock(false);
  const t = state.tpose;
  status(t.ok ? 'Modèle prêt (' + fmt(base.index.length / 3) + ' triangles, T-pose OK).'
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
    render();
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
  const mesh = new THREE.Mesh(
    buildGeometry({ pos: w.pos, uv: w.uv, index: w.index, normals: smoothNormals(w.pos, w.index) }),
    state.src.material);
  mesh.name = state.src.name;
  const wasWire = state.src.material.wireframe;
  state.src.material.wireframe = false;
  status('Export GLB…');
  new GLTFExporter().parse(mesh, result => {
    state.src.material.wireframe = wasWire;
    const blob = new Blob([result], { type: 'model/gltf-binary' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = state.src.name + '_' + Math.round(w.index.length / 3) + 'tri.glb';
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
