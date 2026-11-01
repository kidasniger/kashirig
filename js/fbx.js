// Export FBX : envoie le GLB à l'intermédiaire Vercel, suit le workflow, renvoie l'adresse de téléchargement.
const CHUNK = 2400 * 1024;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function newId() {
  const a = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(a, b => (b % 36).toString(36)).join('');
}

function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

async function call(url, body) {
  const r = await fetch(url, body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } : undefined);
  let j = {};
  try { j = await r.json(); } catch (e) { /* réponse vide */ }
  if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status));
  return j;
}

// onProgress(pourcentage 0-100, texte)
export async function exportFbx(glb, triangles, onProgress) {
  const job = newId();
  const bytes = new Uint8Array(glb);
  const parts = Math.ceil(bytes.length / CHUNK);
  if (parts > 40) throw new Error('Modèle trop gros (95 Mo maximum).');

  for (let i = 0; i < parts; i++) {
    onProgress(2 + 18 * i / parts, 'Envoi');
    await call('/api/upload', { job, index: i, data: b64(bytes.subarray(i * CHUNK, (i + 1) * CHUNK)) });
  }
  onProgress(20, 'Lancement');
  await call('/api/start', { job, triangles });

  const t0 = Date.now();
  for (;;) {
    await sleep(3000);
    if (Date.now() - t0 > 20 * 60 * 1000) throw new Error('Délai dépassé.');
    const s = await call('/api/status?job=' + job);
    if (s.state === 'error') throw new Error(s.message || 'Échec de la conversion.');
    if (s.state === 'done') {
      onProgress(100, 'Terminé');
      return '/api/download?job=' + job + '&id=' + s.artifact;
    }
    onProgress(20 + s.percent * 0.8, s.state === 'queued' ? 'En attente' : 'Conversion');
  }
}
