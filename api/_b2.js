const crypto = require('crypto');

const REGION = process.env.B2_REGION || 'us-east-005';
const ENDPOINT = (process.env.B2_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com').replace(/\/+$/, '');
const BUCKET = process.env.B2_BUCKET || 'kashirig-jobs';
const MAX_BYTES = 200 * 1024 * 1024;

const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const sha = d => crypto.createHash('sha256').update(d).digest('hex');

// Signature AWS SV4 en paramètres d'adresse (lien temporaire), sans dépendance.
function presignRaw({ method, host, path, query = {}, headers = {}, keyId, secret, region, expires, now }) {
  const d = now || new Date();
  const amz = d.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amz.slice(0, 8);
  const scope = day + '/' + region + '/s3/aws4_request';
  const all = { host };
  for (const k of Object.keys(headers)) all[k.toLowerCase()] = headers[k];
  const names = Object.keys(all).sort();
  const q = {
    ...query,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': keyId + '/' + scope,
    'X-Amz-Date': amz,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': names.join(';'),
  };
  const qs = Object.keys(q).sort().map(k => enc(k) + '=' + enc(q[k])).join('&');
  const canon = [
    method,
    path.split('/').map(enc).join('/'),
    qs,
    names.map(n => n + ':' + String(all[n]).trim() + '\n').join(''),
    names.join(';'),
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha(canon)].join('\n');
  let k = hmac('AWS4' + secret, day);
  k = hmac(k, region);
  k = hmac(k, 's3');
  k = hmac(k, 'aws4_request');
  const sig = crypto.createHmac('sha256', k).update(toSign).digest('hex');
  return 'https://' + host + path.split('/').map(enc).join('/') + '?' + qs + '&X-Amz-Signature=' + sig;
}

function configured() {
  return !!(process.env.B2_KEY_ID && process.env.B2_APP_KEY);
}

// Lien temporaire vers un fichier du bucket (chemin : /<bucket>/<clé>).
function presign(method, key, { expires = 600, query = {}, headers = {} } = {}) {
  return presignRaw({
    method,
    host: new URL(ENDPOINT).host,
    path: '/' + BUCKET + '/' + key,
    query,
    headers,
    keyId: process.env.B2_KEY_ID,
    secret: process.env.B2_APP_KEY,
    region: REGION,
    expires,
  });
}

// Vrai si le fichier existe dans le bucket.
async function exists(key) {
  const r = await fetch(presign('HEAD', key, { expires: 60 }), { method: 'HEAD' });
  return r.ok;
}

module.exports = { presign, presignRaw, exists, configured, MAX_BYTES };
