const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function check() {
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  
  console.log('--- Verificando Credentials ---');
  const { data: creds, error: e1 } = await supabase.from('credentials').select('id, service, user_id').eq('service', 'google_ads');
  if (e1) console.error('Error creds:', e1);
  else console.log('Google Ads Credentials encontradas:', creds.length);

  console.log('\n--- Verificando Integrations ---');
  const { data: intg, error: e2 } = await supabase.from('integrations').select('id, service, metadata').eq('service', 'google_ads');
  if (e2) console.error('Error intg:', e2);
  else {
    console.log('Google Ads Integrations encontradas:', intg.length);
    if (intg.length > 0) console.log('Metadata:', JSON.stringify(intg[0].metadata, null, 2));
  }
}

check();
