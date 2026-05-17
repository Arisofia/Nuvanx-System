const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

async function checkIntegrations() {
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  
  try {
    const { data, error } = await supabase.from('integrations').select('*');
    if (error) throw error;
    console.log('--- INTEGRATIONS TABLE ---');
    console.table(data.map(i => ({ service: i.service, metadata: JSON.stringify(i.metadata).slice(0, 50) + '...' })));
    
    const { data: creds, error: err2 } = await supabase.from('credentials').select('*');
    if (err2) throw err2;
    console.log('\n--- CREDENTIALS TABLE ---');
    console.table(creds.map(c => ({ service: c.service, has_key: !!c.encrypted_key })));

  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

checkIntegrations();
