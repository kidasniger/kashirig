const { guard, JOB_RE } = require('./_gh');
const { presign, configured, MAX_BYTES } = require('./_b2');

// Donne un lien temporaire pour envoyer le GLB directement dans le stockage.
module.exports = async (req, res) => {
  if (!guard(req, res, 'POST')) return;
  try {
    if (!configured()) return res.status(500).json({ error: 'Stockage non configuré' });
    const { job, size } = req.body || {};
    if (!JOB_RE.test(job || '')) return res.status(400).json({ error: 'Identifiant invalide' });
    if (!Number.isInteger(size) || size < 1) return res.status(400).json({ error: 'Taille invalide' });
    if (size > MAX_BYTES) return res.status(400).json({ error: 'Modèle trop gros (200 Mo maximum).' });
    const url = presign('PUT', 'jobs/' + job + '/input.glb', {
      expires: 900,
      headers: { 'content-length': String(size) },
    });
    res.status(200).json({ url });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
