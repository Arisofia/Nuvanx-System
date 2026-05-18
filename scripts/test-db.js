const { Client } = require('pg');

async function testDB() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required to run scripts/test-db.js');
    process.exitCode = 1;
    return;
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('  ✅ DB: Connection successful');
    const res = await client.query('SELECT COUNT(*) FROM leads');
    console.log('  ✅ DB: Leads count =', res.rows[0].count);
  } catch (err) {
    console.error('  ❌ DB: Error -', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

testDB();
