const { guard, JOB_RE, NAME_RE } = require('./_gh');
const { presign, exists } = require('./_b2');

// Redirige vers un lien temporaire de téléchargement du FBX.
module.exports = async (req, res) => {
  if (!guard(req, res, 'GET')) return;
  try {
    const job = String((req.query && req.query.job) || '');
    const name = NAME_RE.test(String((req.query && req.query.name) || '')) ? req.query.name : 'model';
    if (!JOB_RE.test(job)) return res.status(400).json({ error: 'Demande invalide' });
    const key = 'jobs/' + job + '/output.fbx';
    if (!(await exists(key))) return res.status(404).json({ error: 'Fichier introuvable' });
    const url = presign('GET', key, {
      expires: 300,
      query: {
        'response-content-disposition': 'attachment; filename="' + name + '_rigged.fbx"',
        'response-content-type': 'application/octet-stream',
      },
    });
    res.setHeader('Location', url);
    res.status(302).end();
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
