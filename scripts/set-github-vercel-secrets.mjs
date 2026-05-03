import https from 'https';
import fs from 'fs';
import { execSync } from 'child_process';
import sodium from 'tweetsodium';

const ghToken = execSync(
  'git credential fill',
  { input: 'protocol=https\nhost=github.com\n', timeout: 3000, encoding: 'utf8' }
).match(/password=(.+)/)[1].trim();

const envContent = fs.readFileSync('.env', 'utf8');
const getEnv = (k) => {
  const m = envContent.match(new RegExp('^' + k + '=(.+)', 'm'));
  return m ? m[1].trim() : '';
};

const secrets = {
  VITE_SUPABASE_URL:             getEnv('VITE_SUPABASE_URL') || getEnv('SUPABASE_URL'),
  VITE_SUPABASE_ANON_KEY:        getEnv('VITE_SUPABASE_ANON_KEY') || getEnv('SUPABASE_ANON_KEY'),
  VITE_SUPABASE_PUBLISHABLE_KEY: getEnv('VITE_SUPABASE_PUBLISHABLE_KEY'),
};

function get(path) {
  return new Promise(resolve => {
    https.get(
      { hostname: 'api.github.com', path, headers: { 'User-Agent': 'nuvanx', 'Authorization': 'Bearer ' + ghToken, 'Accept': 'application/vnd.github+json' } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))); }
    );
  });
}

function put(path, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com', method: 'PUT', path,
      headers: { 'User-Agent': 'nuvanx', 'Authorization': 'Bearer ' + ghToken, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(opts, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(r.statusCode)); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const pk = await get('/repos/Arisofia/Nuvanx-System/actions/secrets/public-key');
for (const [name, value] of Object.entries(secrets)) {
  if (!value) { console.log('SKIP', name, '(empty)'); continue; }
  const encrypted = sodium.seal(Buffer.from(value), Buffer.from(pk.key, 'base64'));
  const status = await put('/repos/Arisofia/Nuvanx-System/actions/secrets/' + name, {
    encrypted_value: Buffer.from(encrypted).toString('base64'),
    key_id: pk.key_id
  });
  console.log(status === 201 ? 'CREATED' : status === 204 ? 'UPDATED' : 'HTTP ' + status, name);
}
console.log('Done.');
