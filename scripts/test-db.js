const { Client } = require('pg');

async function testDB() {
  const passwords = ['Nuvanx2026Prod!', 'rESeQOLZuCTuBQDs', '6tRPQcIrgl3p1Tuu'];
  for (const password of passwords) {
    const masked = password.slice(0, 3) + '***';
    console.log(`\n--- Probando password: ${masked} ---`);
    const client = new Client({
      user: 'postgres.ssvvuuysgxyqvmovrlvk',
      password: password,
      host: 'aws-1-eu-central-1.pooler.supabase.com',
      port: 6543,
      database: 'postgres',
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
