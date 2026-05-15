import { createClient } from '@supabase/supabase-api'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const clinicId = process.env.CLINIC_ID

async function checkResults() {
  const supabase = createClient(supabaseUrl, supabaseKey)
  
  console.log('--- RESULTADOS DE CRUCE (9 DÍGITOS) ---')
  
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, name, phone, phone_normalized, converted_patient_id, verified_revenue, stage')
    .eq('clinic_id', clinicId)
    .not('verified_revenue', 'is', null)
    .gt('verified_revenue', 0)

  if (error) {
    console.error('Error:', error)
    return
  }

  if (leads.length === 0) {
    console.log('No se encontraron leads con ingresos verificados aún.')
    
    // Check total leads vs total patients to see if there's potential
    const { count: totalLeads } = await supabase.from('leads').select('*', { count: 'exact', head: true }).eq('clinic_id', clinicId)
    const { count: totalPatients } = await supabase.from('patients').select('*', { count: 'exact', head: true }).eq('clinic_id', clinicId)
    
    console.log(`Estado actual: ${totalLeads} Leads totales / ${totalPatients} Pacientes totales registrados en Supabase.`)
  } else {
    console.log(`Se han encontrado ${leads.length} coincidencias reales con ingresos vinculados:`)
    leads.forEach(l => {
      console.log(`- Lead: ${l.name} | Tel: ${l.phone} | Revenue: €${l.verified_revenue} | Stage: ${l.stage}`)
    })
  }
}

checkResults()
