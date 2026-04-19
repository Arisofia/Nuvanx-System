'use strict';

const path = require('path');
const backendDir = path.join(__dirname, '..', 'backend');
const dotenv = require(path.join(backendDir, 'node_modules', 'dotenv'));
dotenv.config({ path: path.join(backendDir, '.env') });

const { createClient } = require(path.join(backendDir, 'node_modules', '@supabase', 'supabase-js'));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data: runs } = await supabase.from('agent_runs').select('id, status, created_at').order('created_at', { ascending: false });
  console.log('--- AGENT RUNS ---');
  console.log(JSON.stringify(runs, null, 2));

  const { data: steps } = await supabase.from('agent_run_steps').select('id, run_id, step_name, status');
  console.log('\n--- AGENT RUN STEPS ---');
  console.log(JSON.stringify(steps, null, 2));
}

main().catch(console.error);
