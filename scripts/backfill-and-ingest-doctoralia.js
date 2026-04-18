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

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in environment.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const doctoraliaCsv = `Id Intermediario,Id Op,idplantilla,plantilladescr,Nombre Intermediario,DNI,Nombre Apellidos,Fecha Liquidacion,Fecha Ingreso,Fecha Cancelacion,Importe Bruto,Importe Descuento,Importe Neto
74587,4339835,8747,CAMPAÑA GENERICA EXPRÉS ESTETICA,NUVANX. MEDICINA ESTÉTICA LÁSER,54692486G,BIANCA  MENDEZ PICHARDO,17/03/2026,17/03/2026, ,"1000,00","0,00","1000,00"
74587,4324567,8747,CAMPAÑA GENERICA EXPRÉS ESTETICA,NUVANX. MEDICINA ESTÉTICA LÁSER,51223868Q,MARIA LOPEZ CALVA,07/03/2026,07/03/2026, ,"583,00","0,00","583,00"
74587,4299725,10602,EXPRESS SIN COSTE CLINICA SIN INTERESES,NUVANX. MEDICINA ESTÉTICA LÁSER,51546091D,NORELA PULGARIN MAZO,21/02/2026,21/02/2026, ,"1850,00","0,00","1850,00"
74587,4269250,8747,CAMPAÑA GENERICA EXPRÉS ESTETICA,NUVANX. MEDICINA ESTÉTICA LÁSER,80065501V,EVA MARIA  TARDIO HERNANDEZ,31/01/2026,31/01/2026, ,"485,66","0,00","485,66"
74587,4280441,10602,EXPRESS SIN COSTE CLINICA SIN INTERESES,NUVANX. MEDICINA ESTÉTICA LÁSER,60371682V,JOHANNY KAROLINA GAVIDIA RAMIREZ,08/02/2026,08/04/2026, ,"1344,00","0,00","1344,00"
74587,4348128,10520,CAMPAÑA PLUS INTERÉS CLIENTE,NUVANX. MEDICINA ESTÉTICA LÁSER,50194418T,BEATRIZ PEÑA VELASCO,23/03/2026,23/03/2026, ,"3054,00","0,00","3054,00"`;

async function main() {
  try {
    console.log('--- Phase 3: Backfill and Ingestion starting (via Supabase SDK) ---');

    // 0. Get first clinic id
    const { data: clinics } = await supabase.from('clinics').select('id').limit(1);
    const clinicId = clinics?.[0]?.id;
    if (!clinicId) throw new Error('No clinics found in database.');

    // 1. Backfill patients from leads
    console.log('1. Backfilling patients from leads...');
    const { data: leads } = await supabase.from('leads').select('*').not('dni', 'is', null);
    
    for (const lead of (leads || [])) {
      await supabase.from('patients').upsert({
        clinic_id: lead.clinic_id || clinicId,
        dni: lead.dni,
        name: lead.name,
        email: lead.email,
        phone: lead.phone
      }, { onConflict: 'dni' });
    }
    console.log(`   Processed ${leads?.length || 0} potential patient backfills.`);

    // 2. Ingest Doctoralia financial settlements
    console.log('2. Ingesting Doctoralia financial settlements...');
    const lines = doctoraliaCsv.trim().split('\n').slice(1);
    let ingestedCount = 0;

    for (const line of lines) {
      console.log(`   Processing line: ${line.substring(0, 50)}...`);
      const parts = line.split(',').map(p => p.trim());
      if (parts.length < 13) {
        console.log(`   Skipped line: insufficient parts (${parts.length})`);
        continue;
      }

      const [
        idIntermediario, idOp, idPlantilla, plantillaDescr, nombreIntermediario,
        dni, nombreApellidos, fechaLiquidacion, fechaIngreso, fechaCancelacion,
        importeBruto, importeDescuento, importeNeto
      ] = parts;

      const parseDate = (d) => {
        if (!d || d === ' ' || d === '') return null;
        const [day, month, year] = d.split('/');
        return `${year}-${month}-${day}`;
      };

      const parseAmount = (a) => {
        if (!a) return 0;
        return parseFloat(a.replace(',', '.'));
      };

      const settledAt = parseDate(fechaLiquidacion) || parseDate(fechaIngreso);
      if (!settledAt) continue;

      // Ensure patient exists
      const { data: p } = await supabase.from('patients').upsert({
        clinic_id: clinicId,
        dni: dni,
        name: nombreApellidos
      }, { onConflict: 'dni' }).select().single();

      if (p) {
        await supabase.from('financial_settlements').upsert({
          id: idOp,
          clinic_id: clinicId,
          patient_id: p.id,
          amount_gross: parseAmount(importeBruto),
          amount_discount: parseAmount(importeDescuento),
          amount_net: parseAmount(importeNeto),
          template_name: plantillaDescr,
          settled_at: settledAt
        }, { onConflict: 'id' });
        ingestedCount++;
      }
    }
    console.log(`   Ingested ${ingestedCount} financial settlements.`);

    // 3. Update Patient LTV
    console.log('3. Updating patient total_ltv from settlements...');
    const { data: pData } = await supabase.from('patients').select('id');
    for (const pat of (pData || [])) {
       const { data: sets } = await supabase.from('financial_settlements').select('amount_net').eq('patient_id', pat.id);
       const ltv = (sets || []).reduce((sum, s) => sum + Number(s.amount_net), 0);
       await supabase.from('patients').update({ total_ltv: ltv }).eq('id', pat.id);
    }
    console.log('   LTV updated.');

    // 4. Link leads to patients
    console.log('4. Linking leads to patients via DNI...');
    const { data: allPatients } = await supabase.from('patients').select('id, dni');
    for (const pat of (allPatients || [])) {
        await supabase.from('leads').update({ converted_patient_id: pat.id }).eq('dni', pat.dni);
    }
    console.log('   Linked leads to verified patient records.');

    console.log('--- Phase 3: Backfill and Ingestion complete ---');
  } catch (err) {
    console.error('Error during backfill and ingestion:', err.message);
  }
}

main().catch(console.error);
