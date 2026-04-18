'use strict';

/**
 * Phase 3 Implementation — Day 2 & 3: Backfill and Doctoralia Ingestion
 *
 * This script:
 * 1. Backfills the 'patients' table from the 'leads' table.
 * 2. Ingests Doctoralia CSV data into the 'financial_settlements' table.
 * 3. Links settlements to patients via DNI.
 * 4. Updates 'total_ltv' on the 'patients' table.
 */

const { Pool } = require('pg');
require('dotenv').config();

const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_KEY;

if (!databaseUrl) {
  console.error('Error: DATABASE_URL or SUPABASE_DATABASE_KEY not found in environment.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const doctoraliaCsv = `Id Intermediario,Id Op,idplantilla,plantilladescr,Nombre Intermediario,DNI,Nombre Apellidos,Fecha Liquidacion,Fecha Ingreso,Fecha Cancelacion,Importe Bruto,Importe Descuento,Importe Neto
74587,4339835,8747,CAMPAÑA GENERICA EXPRÉS ESTETICA,NUVANX. MEDICINA ESTÉTICA LÁSER,54692486G,BIANCA  MENDEZ PICHARDO,17/03/2026,17/03/2026, ,"1000,00","0,00","1000,00"
74587,4324567,8747,CAMPAÑA GENERICA EXPRÉS ESTETICA,NUVANX. MEDICINA ESTÉTICA LÁSER,51223868Q,MARIA LOPEZ CALVA,07/03/2026,07/03/2026, ,"583,00","0,00","583,00"
74587,4299725,10602,EXPRESS SIN COSTE CLINICA SIN INTERESES,NUVANX. MEDICINA ESTÉTICA LÁSER,51546091D,NORELA PULGARIN MAZO,21/02/2026,21/02/2026, ,"1850,00","0,00","1850,00"
74587,4269250,8747,CAMPAÑA GENERICA EXPRÉS ESTETICA,NUVANX. MEDICINA ESTÉTICA LÁSER,80065501V,EVA MARIA  TARDIO HERNANDEZ,31/01/2026,31/01/2026, ,"485,66","0,00","485,66"
74587,4280441,10602,EXPRESS SIN COSTE CLINICA SIN INTERESES,NUVANX. MEDICINA ESTÉTICA LÁSER,60371682V,JOHANNY KAROLINA GAVIDIA RAMIREZ,08/02/2026,08/04/2026, ,"1344,00","0,00","1344,00"
74587,4348128,10520,CAMPAÑA PLUS INTERÉS CLIENTE,NUVANX. MEDICINA ESTÉTICA LÁSER,50194418T,BEATRIZ PEÑA VELASCO,23/03/2026,23/03/2026, ,"3054,00","0,00","3054,00"`;

async function main() {
  const client = await pool.connect();
  try {
    console.log('--- Phase 3: Backfill and Ingestion starting ---');

    // 1. Backfill patients from leads (deterministic: phone or email)
    console.log('1. Backfilling patients from leads...');
    const backfillRes = await client.query(`
      INSERT INTO patients (clinic_id, dni, name, email, phone)
      SELECT 
        COALESCE(clinic_id, (SELECT id FROM clinics LIMIT 1)), 
        dni, 
        name, 
        email, 
        phone
      FROM leads
      WHERE (dni IS NOT NULL OR phone IS NOT NULL OR email IS NOT NULL)
      ON CONFLICT (dni) DO NOTHING
      RETURNING id, dni, phone, email;
    `);
    console.log(`   Processed ${backfillRes.rowCount} potential patient backfills.`);

    // 2. Parse and Ingest Doctoralia CSV
    console.log('2. Ingesting Doctoralia financial settlements...');
    const lines = doctoraliaCsv.trim().split('\n').slice(1);
    let ingestedCount = 0;

    for (const line of lines) {
      // Very basic CSV parser (doesn't handle commas inside quotes, but our data is predictable here)
      // Actually, let's split by "," but handle the quotes for the amounts.
      const parts = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || [];
      if (parts.length < 13) continue;

      const [
        idIntermediario, idOp, idPlantilla, plantillaDescr, nombreIntermediario,
        dni, nombreApellidos, fechaLiquidacion, fechaIngreso, fechaCancelacion,
        importeBruto, importeDescuento, importeNeto
      ] = parts.map(p => p.replace(/"/g, '').trim());

      const parseDate = (d) => {
        if (!d || d === '') return null;
        const [day, month, year] = d.split('/');
        return `${year}-${month}-${day}`;
      };

      const parseAmount = (a) => {
        if (!a) return 0;
        return parseFloat(a.replace(',', '.'));
      };

      const settledAt = parseDate(fechaLiquidacion) || parseDate(fechaIngreso);
      if (!settledAt) continue;

      // First, ensure patient exists for this DNI
      const patientRes = await client.query(
        'INSERT INTO patients (clinic_id, dni, name) VALUES ((SELECT id FROM clinics LIMIT 1), $1, $2) ON CONFLICT (dni) DO UPDATE SET updated_at = NOW() RETURNING id',
        [dni, nombreApellidos]
      );
      const patientId = patientRes.rows[0].id;

      await client.query(`
        INSERT INTO financial_settlements (
          id, clinic_id, patient_id, amount_gross, amount_discount, amount_net, 
          template_name, settled_at
        ) VALUES ($1, (SELECT id FROM clinics LIMIT 1), $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
      `, [
        idOp, patientId, parseAmount(importeBruto), parseAmount(importeDescuento), 
        parseAmount(importeNeto), plantillaDescr, settledAt
      ]);
      ingestedCount++;
    }
    console.log(`   Ingested ${ingestedCount} financial settlements.`);

    // 3. Update Patient LTV
    console.log('3. Updating patient total_ltv from settlements...');
    await client.query(`
      UPDATE patients
      SET total_ltv = (
        SELECT SUM(amount_net)
        FROM financial_settlements
        WHERE patient_id = patients.id
      )
      WHERE id IN (SELECT DISTINCT patient_id FROM financial_settlements);
    `);
    console.log('   LTV updated.');

    // 4. Link leads to patients and update stages
    console.log('4. Linking leads to patients via DNI...');
    const linkRes = await client.query(`
      UPDATE leads
      SET 
        converted_patient_id = p.id,
        stage = CASE 
          WHEN stage = 'lead' THEN 'appointment_booked'::lead_stage -- placeholder enum conversion if we used type
          ELSE stage 
        END
      FROM patients p
      WHERE leads.dni = p.dni AND leads.converted_patient_id IS NULL;
    `);
    console.log(`   Linked ${linkRes.rowCount} leads to verified patient records.`);

    console.log('--- Phase 3: Backfill and Ingestion complete ---');
  } catch (err) {
    console.error('Error during backfill and ingestion:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
