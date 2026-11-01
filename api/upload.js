const { gh, guard, JOB_RE } = require('./_gh');

// Reçoit une partie du GLB (base64) et la dépose sur la branche temporaire job-<id>.
module.exports = async (req, res) => {
  if (!guard(req, res, 'POST')) return;
  try {
    const { job, index, data } = req.body || {};
    if (!JOB_RE.test(job || '')) return res.status(400).json({ error: 'Identifiant invalide' });
    if (!Number.isInteger(index) || index < 0 || index > 39) return res.status(400).json({ error: 'Partie invalide' });
    if (typeof data !== 'string' || !data.length || data.length > 3600000) return res.status(400).json({ error: 'Partie trop grosse' });

    if (index === 0) {
      const ref = await gh('/git/ref/heads/main');
      if (!ref.ok) return res.status(502).json({ error: 'Branche main introuvable' });
      const sha = (await ref.json()).object.sha;
      const mk = await gh('/git/refs', {
        method: 'POST',
        body: JSON.stringify({ ref: 'refs/heads/job-' + job, sha }),
      });
      if (!mk.ok) return res.status(502).json({ error: 'Création de la branche impossible' });
    }

    const name = String(index).padStart(3, '0');
    const put = await gh('/contents/jobs/' + job + '/' + name + '.part', {
      method: 'PUT',
      body: JSON.stringify({ message: 'partie ' + name, content: data, branch: 'job-' + job }),
    });
    if (!put.ok) return res.status(502).json({ error: 'Envoi refusé par GitHub' });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
