const REPO = process.env.GITHUB_REPO || 'kidasniger/kashirig';
const ALLOWED = (process.env.ALLOWED_ORIGINS || 'https://kashirig.vercel.app').split(',');
const JOB_RE = /^[a-z0-9]{8,32}$/;

function gh(path, init = {}) {
  return fetch('https://api.github.com/repos/' + REPO + path, {
    ...init,
    headers: {
      Authorization: 'Bearer ' + process.env.GITHUB_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'kashirig',
      ...(init.headers || {}),
    },
  });
}

// Retrouve le run du workflow pour un job donné.
async function findRun(job) {
  const list = await gh('/actions/workflows/rig.yml/runs?event=workflow_dispatch&per_page=30');
  if (!list.ok) return { error: true };
  const runs = (await list.json()).workflow_runs || [];
  return { run: runs.find(r => r.display_title === 'rig ' + job) || null };
}

function guard(req, res, method) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== method) {
    res.status(405).json({ error: 'Méthode refusée' });
    return false;
  }
  const origin = req.headers.origin;
  if (origin && !ALLOWED.includes(origin)) {
    res.status(403).json({ error: 'Origine refusée' });
    return false;
  }
  return true;
}

const NAME_RE = /^[A-Za-z0-9_-]{1,40}$/;

module.exports = { gh, guard, findRun, JOB_RE, NAME_RE, REPO };
