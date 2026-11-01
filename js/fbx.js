// Export FBX : envoie le GLB au stockage (lien temporaire), lance le workflow, renvoie l'adresse de téléchargement.
const MAX_BYTES = 200 * 1024 * 1024;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function newId() {
  const a = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(a, b => (b % 36).toString(36)).join('');
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
export async function exportFbx(glb, triangles, name, onProgress) {
  const job = newId();
  const bytes = new Uint8Array(glb);
  if (bytes.length > MAX_BYTES) throw new Error('Modèle trop gros (200 Mo maximum).');

  onProgress(3, 'Envoi');
  const { url } = await call('/api/upload', { job, size: bytes.length });
  const put = await fetch(url, { method: 'PUT', body: bytes });
  if (!put.ok) throw new Error('Envoi refusé (' + put.status + ').');

  onProgress(20, 'Lancement');
  await call('/api/start', { job, triangles, name });

  const t0 = Date.now();
  for (;;) {
    await sleep(3000);
    if (Date.now() - t0 > 20 * 60 * 1000) throw new Error('Délai dépassé.');
    const s = await call('/api/status?job=' + job);
    if (s.state === 'error') throw new Error(s.message || 'Échec de la conversion.');
    if (s.state === 'done') {
      onProgress(100, 'Terminé');
      return '/api/download?job=' + job + '&name=' + encodeURIComponent(name);
    }
    onProgress(20 + s.percent * 0.8, s.state === 'queued' ? 'En attente' : 'Conversion');
  }
}
