const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    console.log('--- Atribución en settlements Doctoralia ---');
    const res = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(patient_id) as with_patient_id,
        COUNT(dni_hash) as with_dni_hash,
        COUNT(*) FILTER (WHERE patient_id IS NULL AND dni_hash IS NULL) as both_null
      FROM public.financial_settlements
      WHERE source_system = 'doctoralia';
    `);
    console.table(res.rows);

  } catch (err) {
    console.error('Error executing queries:', err);
  } finally {
    await client.end();
  }
}

run();
