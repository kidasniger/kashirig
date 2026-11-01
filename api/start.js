const { gh, guard, JOB_RE, NAME_RE } = require('./_gh');
const { exists, configured } = require('./_b2');

// Lance le workflow rig.yml pour le job donné, une fois le GLB envoyé.
module.exports = async (req, res) => {
  if (!guard(req, res, 'POST')) return;
  try {
    if (!configured()) return res.status(500).json({ error: 'Stockage non configuré' });
    const { job, triangles } = req.body || {};
    const name = NAME_RE.test((req.body || {}).name || '') ? req.body.name : 'model';
    if (!JOB_RE.test(job || '')) return res.status(400).json({ error: 'Identifiant invalide' });
    if (!(await exists('jobs/' + job + '/input.glb'))) return res.status(400).json({ error: 'Modèle non reçu' });
    const tris = Math.min(100000, Math.max(5000, parseInt(triangles, 10) || 40000));
    const r = await gh('/actions/workflows/rig.yml/dispatches', {
      method: 'POST',
      body: JSON.stringify({ ref: 'main', inputs: { job, name, triangles: String(tris) } }),
    });
    if (!r.ok) return res.status(502).json({ error: 'Lancement impossible' });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
