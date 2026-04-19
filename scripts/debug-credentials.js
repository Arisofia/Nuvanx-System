'use strict';

const path = require('path');
const backendDir = path.join(__dirname, '..', 'backend');
const dotenv = require(path.join(backendDir, 'node_modules', 'dotenv'));
dotenv.config({ path: path.join(backendDir, '.env') });

const { createClient } = require(path.join(backendDir, 'node_modules', '@supabase', 'supabase-js'));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in backend/.env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('--- Credential Audit ---');
  console.log(`Supabase URL: ${supabaseUrl}`);
  
  const { data, error } = await supabase
    .from('credentials')
    .select('id, user_id, service, created_at');

  if (error) {
    console.error('Error fetching credentials:', error);
    process.exit(1);
  }

  console.log(`Found ${data.length} credentials:`);
  data.forEach(cred => {
    console.log(`- ${cred.service} (ID: ${cred.id}, User: ${cred.user_id}, Created: ${cred.created_at})`);
  });

  const { data: users, error: userError } = await supabase
    .from('users')
    .select('id, email, name');

  if (userError) {
    console.error('Error fetching users:', userError);
  } else {
    console.log(`\nFound ${users.length} users:`);
    users.forEach(user => {
      console.log(`- ${user.email} (ID: ${user.id}, Name: ${user.name})`);
    });
  }
}

main().catch(console.error);
