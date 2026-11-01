const { gh, guard, JOB_RE } = require('./_gh');

// Lance le workflow rig.yml pour le job donné.
module.exports = async (req, res) => {
  if (!guard(req, res, 'POST')) return;
  try {
    const { job, triangles } = req.body || {};
    if (!JOB_RE.test(job || '')) return res.status(400).json({ error: 'Identifiant invalide' });
    const tris = Math.min(100000, Math.max(5000, parseInt(triangles, 10) || 40000));
    const r = await gh('/actions/workflows/rig.yml/dispatches', {
      method: 'POST',
      body: JSON.stringify({ ref: 'main', inputs: { job, triangles: String(tris) } }),
    });
    if (!r.ok) return res.status(502).json({ error: 'Lancement impossible' });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
