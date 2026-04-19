'use strict';

const fs = require('fs');
const path = require('path');
const backendDir = path.join(__dirname, '..', 'backend');
const envPath = path.join(backendDir, '.env');
const dotenv = require(path.join(backendDir, 'node_modules', 'dotenv'));
dotenv.config({ path: envPath });

const { createClient } = require(path.join(backendDir, 'node_modules', '@supabase', 'supabase-js'));
const { decrypt } = require(path.join(backendDir, 'src', 'services', 'encryption'));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const encryptionKey = process.env.ENCRYPTION_KEY;

if (!supabaseUrl || !supabaseKey || !encryptionKey) {
  console.error('ERROR: Missing core config in backend/.env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const SERVICE_MAP = {
  'meta': 'META_ACCESS_TOKEN',
  'openai': 'OPENAI_API_KEY',
  'gemini': 'GEMINI_API_KEY',
  'anthropic': 'ANTHROPIC_API_KEY',
  'whatsapp': 'WHATSAPP_ACCESS_TOKEN',
  'figma': 'FIGMA_PAT',
  'google': 'GOOGLE_API_KEY'
};

async function main() {
  console.log('--- Seeding .env from Database Credentials ---');
  
  const { data, error } = await supabase
    .from('credentials')
    .select('service, encrypted_key')
    .eq('user_id', 'a2f2b8a1-fedb-4a74-891d-b8a2089fd49a'); // Admin user ID

  if (error) {
    console.error('Error fetching credentials:', error);
    process.exit(1);
  }

  let envContent = fs.readFileSync(envPath, 'utf8');
  let updated = false;

  for (const cred of data) {
    const envKey = SERVICE_MAP[cred.service];
    if (!envKey) continue;

    try {
      const decrypted = decrypt(cred.encrypted_key, encryptionKey);
      
      // Check if current value in .env is empty
      const regex = new RegExp(`^${envKey}=(.*)$`, 'm');
      const match = envContent.match(regex);
      
      if (match && (!match[1] || match[1].trim() === '')) {
        console.log(`Updating ${envKey}...`);
        envContent = envContent.replace(regex, `${envKey}=${decrypted}`);
        updated = true;
      } else if (!match) {
        console.log(`Adding ${envKey}...`);
        envContent += `\n${envKey}=${decrypted}`;
        updated = true;
      } else {
        console.log(`Skipping ${envKey} (already has value)`);
      }
    } catch (e) {
      console.error(`Failed to decrypt ${cred.service}:`, e.message);
    }
  }

  if (updated) {
    fs.writeFileSync(envPath, envContent);
    console.log('\n.env updated successfully.');
  } else {
    console.log('\nNo changes needed for .env.');
  }
}

main().catch(console.error);
