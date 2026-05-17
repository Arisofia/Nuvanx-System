const { createClient } = require('@supabase/supabase-js');
const crypto = require('node:crypto');
const dotenv = require('dotenv');
dotenv.config();

const MASTER_KEYS = [
  process.env.ENCRYPTION_KEY,
  Buffer.from(process.env.ENCRYPTION_KEY || '', 'base64').toString('utf8'),
  'Nuvanx2026Prod!', // Try the DB password as a potential key
  'Nuvanx-System'
].filter(k => k && k.length > 0);

function decrypt(encoded, masterKey) {
  try {
    const parts = encoded.split(':');
    if (parts.length !== 4) return null;
    const [saltHex, ivHex, tagHex, ctHex] = parts;
    const salt = Buffer.from(saltHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ct = Buffer.from(ctHex, 'hex');
    
    // Method 1: PBKDF2
    try {
      const key = crypto.pbkdf2Sync(masterKey, salt, 100000, 32, 'sha256');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return decipher.update(ct, 'binary', 'utf8') + decipher.final('utf8');
    } catch (e) {}

    // Method 2: Direct Hash
    try {
      const key = crypto.createHash('sha256').update(masterKey).digest();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return decipher.update(ct, 'binary', 'utf8') + decipher.final('utf8');
    } catch (e) {}

    return null;
  } catch (err) {
    return null;
  }
}

async function run() {
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: creds } = await supabase.from('credentials').select('*');
  
  console.log('--- ATTEMPTING DECRYPTION ---');
  for (const c of creds) {
    for (const key of MASTER_KEYS) {
      const decrypted = decrypt(c.encrypted_key, key);
      if (decrypted) {
        console.log(`✅ SUCCESS [Key: ${key.slice(0, 5)}...] Service: ${c.service} -> ${decrypted.slice(0, 15)}...`);
        // If we found Francisco's token (it won't be Judith's)
        if (c.service === 'meta' && !decrypted.includes('Judith')) {
           // We might need to check the token info to see whose it is
        }
      }
    }
  }
}

run();
