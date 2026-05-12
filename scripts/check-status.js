const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function check() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  try {
    const { count: linkedLeads } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .not('converted_patient_id', 'is', null);
    
    const { data: revData } = await supabase
      .from('leads')
      .select('verified_revenue');
    
    const totalRev = revData ? revData.reduce((acc, curr) => acc + (Number(curr.verified_revenue) || 0), 0) : 0;
    
    const { count: settlements } = await supabase
      .from('financial_settlements')
      .select('*', { count: 'exact', head: true });

    const { count: patients } = await supabase
      .from('patients')
      .select('*', { count: 'exact', head: true });

    console.log('--- DIAGNOSTICS ---');
    console.log('Total Patients:', patients);
    console.log('Total Settlements:', settlements);
    console.log('Leads linked to patients:', linkedLeads);
    console.log('Total verified_revenue in leads table:', totalRev);
    console.log('-------------------');

    // Sample matching
    const { data: sampleLeads } = await supabase
      .from('leads')
      .select('id, phone_normalized')
      .is('converted_patient_id', null)
      .not('phone_normalized', 'is', null)
      .limit(5);
    
    console.log('Sample Leads (unlinked):', sampleLeads);

    const { data: dpPatients, error: dpError } = await supabase
      .from('doctoralia_patients')
      .select('doc_patient_id, phone_primary, phone_normalized')
      .limit(10);

    if (dpError) {
      console.log('doctoralia_patients error:', dpError.message);
    }

    const { count: rawWithPhone } = await supabase
      .from('doctoralia_raw')
      .select('*', { count: 'exact', head: true })
      .not('phone_primary', 'is', null);
    
    console.log('doctoralia_raw rows with phone_primary:', rawWithPhone);

    const patientIds = Array.isArray(dpPatients)
      ? dpPatients.map(p => p.doc_patient_id).filter(Boolean)
      : [];

    let patientMatches = [];
    if (patientIds.length > 0) {
      const result = await supabase
        .from('patients')
        .select('id, dni')
        .in('dni', patientIds);
      patientMatches = result.data;
    } else {
      console.log('No Doctoralia patient IDs available for patient matching.');
    }
    
    console.log('Patients matching Doctoralia Patient IDs (DNI):', patientMatches);

    const { count: withPatient } = await supabase
      .from('financial_settlements')
      .select('*', { count: 'exact', head: true })
      .not('patient_id', 'is', null);
    
    console.log('Settlements with patient_id:', withPatient);

    const { count: withPhone } = await supabase
      .from('financial_settlements')
      .select('*', { count: 'exact', head: true })
      .not('phone_normalized', 'is', null);
    
    console.log('Settlements with phone_normalized:', withPhone);
    const { data: rpcResult, error: rpcError } = await supabase.rpc('match_leads_to_doctoralia_by_phone');
    if (rpcError) {
      console.log('match_leads_to_doctoralia_by_phone failed:', rpcError.message);
      const { data: rpcResult2, error: rpcError2 } = await supabase.rpc('match_doctoralia_leads_by_phone');
      if (rpcError2) {
        console.log('match_doctoralia_leads_by_phone failed:', rpcError2.message);
      } else {
        console.log('match_doctoralia_leads_by_phone success:', rpcResult2);
      }
    } else {
      console.log('match_leads_to_doctoralia_by_phone success:', rpcResult);
    }

  } catch (e) {
    console.error(e);
  }
}

check();
