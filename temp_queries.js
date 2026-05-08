const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    console.log('--- Consulta 1 (Leads reales) ---');
    const res1 = await client.query(`
      SELECT 
        COUNT(*) as total_leads,
        COUNT(*) FILTER (WHERE source != 'doctoralia') as leads_adquisicion,
        COUNT(*) FILTER (WHERE source = 'doctoralia') as leads_doctoralia
      FROM public.leads;
    `);
    console.table(res1.rows);

    console.log('\n--- Consulta 2 (Revenue real - Doctoralia) ---');
    const res2 = await client.query(`
      SELECT 
        COUNT(*) as total_settlements,
        SUM(amount_net) as revenue_verificado_doctoralia
      FROM public.financial_settlements
      WHERE source_system = 'doctoralia';
    `);
    console.table(res2.rows);

    console.log('\n--- Consulta 3 (Datos de Meta) ---');
    const res3 = await client.query(`
      SELECT COUNT(*) as registros_meta
      FROM public.meta_daily_insights;
    `);
    console.table(res3.rows);

  } catch (err) {
    console.error('Error executing queries:', err);
  } finally {
    await client.end();
  }
}

run();
