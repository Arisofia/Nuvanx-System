const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = 'postgresql://postgres.ssvvuuysgxyqvmovrlvk:n5SNU4AYoEmuJ6RXiVqMchLCxOWlwfeB@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';

async function main() {
  const client = new Client({
    connectionString: connectionString,
  });

  try {
    await client.connect();
    console.log('Connected to database');
    const sql = fs.readFileSync(path.join(__dirname, 'supabase', 'migrations', '20260511124100_audit_cleanup_doctoralia_exclusion.sql'), 'utf8');
    await client.query(sql);
    console.log('SQL executed successfully');
  } catch (err) {
    console.error('Error executing SQL:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
