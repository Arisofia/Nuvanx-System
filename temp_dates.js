const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    console.log('--- Rango de fechas settlements Doctoralia ---');
    const res = await client.query(`
      SELECT 
        MIN(settled_at) as first_settlement,
        MAX(settled_at) as last_settlement,
        COUNT(*) as count
      FROM public.financial_settlements
      WHERE source_system = 'doctoralia';
    `);
    console.table(res.rows);

    console.log('\n--- Sample of settlements ---');
    const res2 = await client.query(`
      SELECT settled_at, amount_net, patient_id
      FROM public.financial_settlements
      WHERE source_system = 'doctoralia'
      ORDER BY settled_at DESC
      LIMIT 10;
    `);
    console.table(res2.rows);

  } catch (err) {
    console.error('Error executing queries:', err);
  } finally {
    await client.end();
  }
}

run();
