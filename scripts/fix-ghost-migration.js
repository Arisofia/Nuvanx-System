const { Client } = require('pg');

const databaseUrl = 'postgresql://postgres.ssvvuuysgxyqvmovrlvk:n5SNU4AYoEmuJ6RXiVqMchLCxOWlwfeB@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';

async function fix() {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    console.log('Connected to database.');
    
    const res = await client.query("DELETE FROM supabase_migrations WHERE version = '20260505220000'");
    console.log(`Deleted ${res.rowCount} row(s) from supabase_migrations.`);
    
  } catch (err) {
    console.error('Error executing query:', err);
  } finally {
    await client.end();
  }
}

fix();
