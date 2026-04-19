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
  console.log('--- Real-Time Forensic Verification ---');
  
  const { data: agentOutputs } = await supabase.from('agent_outputs').select('count', { count: 'exact' });
  const { data: agentRuns } = await supabase.from('agent_runs').select('count', { count: 'exact' });
  const { data: metaIntegration } = await supabase
    .from('integrations')
    .select('metadata, status')
    .eq('service', 'meta')
    .single();

  console.log(`\nSTATE OF REALITY:`);
  console.log(`- agent_outputs rows: ${agentOutputs?.length || 0}`);
  console.log(`- agent_runs rows:    ${agentRuns?.length || 0}`);
  console.log(`- Meta metadata:     ${JSON.stringify(metaIntegration?.metadata || {})}`);
  console.log(`- Meta status:       ${metaIntegration?.status || 'unknown'}`);
}

main().catch(console.error);
