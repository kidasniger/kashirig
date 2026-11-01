const { gh, guard, JOB_RE } = require('./_gh');

// Redirige vers le téléchargement de l'artefact (zip contenant rigged.fbx).
module.exports = async (req, res) => {
  if (!guard(req, res, 'GET')) return;
  try {
    const job = String((req.query && req.query.job) || '');
    const id = parseInt(req.query && req.query.id, 10);
    if (!JOB_RE.test(job) || !Number.isInteger(id)) return res.status(400).json({ error: 'Demande invalide' });

    const meta = await gh('/actions/artifacts/' + id);
    if (!meta.ok) return res.status(404).json({ error: 'Fichier introuvable' });
    if ((await meta.json()).name !== 'fbx-' + job) return res.status(403).json({ error: 'Fichier refusé' });

    const z = await gh('/actions/artifacts/' + id + '/zip', { redirect: 'manual' });
    const loc = z.headers.get('location');
    if (!loc) return res.status(502).json({ error: 'Téléchargement indisponible' });
    res.setHeader('Location', loc);
    res.status(302).end();
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
