const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

async function run() {
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: creds } = await supabase.from('credentials').select('*');
  
  console.log('--- ENCRYPTED VALUES ---');
  for (const c of creds) {
    console.log(`Service: ${c.service}, Key: ${c.encrypted_key.slice(0, 40)}...`);
  }
}

run();
