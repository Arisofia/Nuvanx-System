const { Client } = require('pg');

async function testDB() {
  const passwords = [process.env.SUPABASE_DB_PASSWORD].filter(Boolean);
  if (passwords.length === 0) {
    console.log('  ❌ Error: SUPABASE_DB_PASSWORD no configurada en el entorno');
    return;
  }
  for (const password of passwords) {
    console.log('\n--- Probando conexión a la base de datos ---');
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
