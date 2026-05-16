const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

async function run() {
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  
  const { data: users } = await supabase.from('users').select('*');
  console.log('--- USERS ---');
  console.table(users.map(u => ({ id: u.id, email: u.email, name: u.name, clinic: u.clinic_id })));

  const { data: integrations } = await supabase.from('integrations').select('*');
  console.log('\n--- INTEGRATIONS ---');
  console.table(integrations.map(i => ({ service: i.service, user_id: i.user_id, metadata: JSON.stringify(i.metadata).slice(0, 50) })));
}

run();
