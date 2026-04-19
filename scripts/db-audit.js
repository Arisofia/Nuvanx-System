
const path = require('path');
const backendDir = path.join(__dirname, '..', 'backend');
const { createClient } = require(path.join(backendDir, 'node_modules', '@supabase', 'supabase-js'));
const dotenv = require(path.join(backendDir, 'node_modules', 'dotenv'));
const crypto = require('crypto');

dotenv.config({ path: path.join(backendDir, '.env') });

const ENC = process.env.ENCRYPTION_KEY;

function decrypt(encrypted) {
  if (!encrypted || !ENC) return null;
  try {
    const parts = encrypted.split(':');
    if (parts.length !== 4) return 'Invalid format';
    const [salt, iv, authTag, ct] = parts.map((s) => Buffer.from(s, 'hex'));
    const key = crypto.pbkdf2Sync(ENC, salt, 100000, 32, 'sha256');
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(authTag);
    const dt = Buffer.concat([d.update(ct), d.final()]);
    return dt.toString('utf8');
  } catch (e) {
    return 'Error decrypting: ' + e.message;
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function audit() {
  console.log('--- Database Audit ---');
  
  const { data: credentials, error: credentialsError } = await supabase
    .from('credentials')
    .select('id, user_id, service, encrypted_key, last_used');
  
  if (credentialsError) {
    console.error('Credentials error:', credentialsError.message);
    return;
  }

  console.log('Credentials Status: ' + credentials.length);
  for (const c of credentials) {
    const dec = decrypt(c.encrypted_key);
    console.log('  - ' + c.service + ' for ' + c.user_id + ': content=' + dec);
  }
}

audit();
