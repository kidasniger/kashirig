const { gh, guard, findRun, JOB_RE } = require('./_gh');

// Poids des étapes du workflow pour calculer le pourcentage.
const WEIGHTS = { 'Installer Blender': 20, 'Lancer le rig': 50 };

module.exports = async (req, res) => {
  if (!guard(req, res, 'GET')) return;
  try {
    const job = String((req.query && req.query.job) || '');
    if (!JOB_RE.test(job)) return res.status(400).json({ error: 'Identifiant invalide' });

    const found = await findRun(job);
    if (found.error) return res.status(502).json({ error: 'GitHub indisponible' });
    const run = found.run;
    if (!run) return res.status(200).json({ state: 'queued', percent: 2 });

    if (run.status === 'completed') {
      if (run.conclusion !== 'success') {
        return res.status(200).json({ state: 'error', percent: 100, message: 'La conversion a échoué.' });
      }
      const a = await gh('/actions/runs/' + run.id + '/artifacts');
      const art = a.ok ? ((await a.json()).artifacts || []).find(x => x.name.endsWith('_rigged')) : null;
      if (!art) return res.status(200).json({ state: 'error', percent: 100, message: 'Fichier introuvable.' });
      return res.status(200).json({ state: 'done', percent: 100, artifact: art.id });
    }

    const jr = await gh('/actions/runs/' + run.id + '/jobs');
    const steps = jr.ok ? ((((await jr.json()).jobs || [])[0] || {}).steps || []) : [];
    let total = 0, done = 0;
    for (const s of steps) {
      const w = WEIGHTS[s.name] || 2;
      total += w;
      if (s.status === 'completed') done += w;
    }
    const percent = total ? Math.min(95, Math.max(5, Math.round(done / total * 100))) : 5;
    res.status(200).json({ state: run.status === 'queued' ? 'queued' : 'running', percent });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
