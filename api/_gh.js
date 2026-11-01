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

module.exports = { gh, guard, JOB_RE, REPO };
