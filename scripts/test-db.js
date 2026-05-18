const { Client } = require('pg');

async function testDB() {
  const passwords = [process.env.DB_PASSWORD].filter(Boolean);
  if (passwords.length === 0) {
    console.log('  ❌ Error: DB_PASSWORD environment variable not set');
    return;
  }
  for (const password of passwords) {
    const client = new Client({
      user: process.env.DB_USER || 'postgres.ssvvuuysgxyqvmovrlvk',
      password: password,
      host: process.env.DB_HOST || 'aws-1-eu-central-1.pooler.supabase.com',
      port: process.env.DB_PORT || 6543,
      database: process.env.DB_NAME || 'postgres',
      ssl: { rejectUnauthorized: false }
    });
    try {
      await client.connect();
      console.log('  ✅ DB: Conexión exitosa');
      const res = await client.query('SELECT COUNT(*) FROM leads');
      console.log('  ✅ DB: Leads count =', res.rows[0].count);
      break;
    } catch (err) {
      console.log('  ❌ DB: Error -', err.message);
    } finally {
      await client.end();
    }
  }
}

testDB();
