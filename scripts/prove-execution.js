'use strict';

const path = require('path');
const backendDir = path.join(__dirname, '..', 'backend');
const dotenv = require(path.join(backendDir, 'node_modules', 'dotenv'));
dotenv.config({ path: path.join(backendDir, '.env') });

const axios = require(path.join(backendDir, 'node_modules', 'axios'));
const jwt = require(path.join(backendDir, 'node_modules', 'jsonwebtoken'));

const ADMIN_ID = 'a2f2b8a1-fedb-4a74-891d-b8a2089fd49a';
const { JWT_SECRET } = process.env;
const API_URL = 'http://localhost:3001'; // Assuming local dev for proof

async function main() {
  console.log('--- Proving API and Agent Execution Chain ---');

  // 1. Generate Token
  const token = jwt.sign({ id: ADMIN_ID, email: 'jenineferderas@hotmail.com' }, JWT_SECRET);
  console.log(`- Token generated: ${token.slice(0, 20)}...`);

  // 2. Call Health
  try {
    const { status, data: healthData } = await axios.get(`${API_URL}/health`);
    console.log(`- /health status: ${status} (${healthData.status})`);
  } catch (e) {
    console.log(`- /health failed (is backend running?): ${e.message}`);
  }

  // 3. Trigger Playbook
  try {
    const { data } = await axios.post(
      `${API_URL}/api/playbooks/lead-capture-nurture/run`,
      { metadata: { test: true } },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log(`- Playbook Run Result: ${JSON.stringify(data)}`);
  } catch (e) {
    console.log(`- Playbook Run failed: ${e.response?.data?.message || e.message}`);
  }
}

main().catch(console.error);
