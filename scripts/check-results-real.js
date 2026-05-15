const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const clinicId = process.env.CLINIC_ID

async function checkResults() {
  const supabase = createClient(supabaseUrl, supabaseKey)
  
  console.log('--- RESULTADOS DE CRUCE (9 DÍGITOS) ---')
  
  // Realizar un cruce de prueba manual para ver si hay potenciales
  const { data: matchedRows } = await supabase.rpc('reconcile_doctoralia_subjects_to_leads', { p_user_id: process.env.WEBHOOK_ADMIN_USER_ID || '00000000-0000-0000-0000-000000000000' })
  console.log(`Matching disparado: ${matchedRows} registros actualizados en esta pasada.`)

  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, name, phone, phone_normalized, converted_patient_id, verified_revenue, stage')
    .eq('clinic_id', clinicId)
    .not('verified_revenue', 'is', null)
    .gt('verified_revenue', 0)

  if (error) {
    console.error('Error fetching leads:', error)
    return
  }

  if (!leads || leads.length === 0) {
    console.log('No se encontraron leads con ingresos verificados aún con 9-dígitos.')
    
    // Estadísticas generales para diagnóstico
    const { count: totalLeads } = await supabase.from('leads').select('*', { count: 'exact', head: true }).eq('clinic_id', clinicId)
    const { count: totalSettlements } = await supabase.from('financial_settlements').select('*', { count: 'exact', head: true }).eq('clinic_id', clinicId)
    const { count: totalPatients } = await supabase.from('patients').select('*', { count: 'exact', head: true }).eq('clinic_id', clinicId)
    
    console.log(`Diagnóstico:`)
    console.log(`- Leads en base: ${totalLeads}`)
    console.log(`- Liquidaciones (Doctoralia): ${totalSettlements}`)
    console.log(`- Pacientes registrados: ${totalPatients}`)

    // Ver si las liquidaciones tienen teléfono
    const { data: phoneStats } = await supabase
      .from('financial_settlements')
      .select('patient_phone')
      .eq('clinic_id', clinicId)
      .not('patient_phone', 'is', null)
      .limit(1)
    
    const { count: settlementsWithPhone } = await supabase
      .from('financial_settlements')
      .select('*', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .not('patient_phone', 'is', null)
    
    console.log(`- Liquidaciones con teléfono: ${settlementsWithPhone}`)

    // Ver un ejemplo de teléfono de lead y uno de liquidación (anonimizado los últimos dígitos si es necesario, pero aquí solo para diagnóstico interno)
    const { data: leadExample } = await supabase.from('leads').select('phone').eq('clinic_id', clinicId).not('phone', 'is', null).limit(1)
    const { data: settExample } = await supabase.from('financial_settlements').select('patient_phone').eq('clinic_id', clinicId).not('patient_phone', 'is', null).limit(1)
    
    console.log(`- Ejemplo Tel Lead: ${leadExample?.[0]?.phone || 'N/A'}`)
    console.log(`- Ejemplo Tel Sett: ${settExample?.[0]?.patient_phone || 'N/A'}`)
    
    if (leadExample?.[0]?.phone && settExample?.[0]?.patient_phone) {
      const l9 = leadExample[0].phone.slice(-9)
      const s9 = settExample[0].patient_phone.slice(-9)
      console.log(`- Match 9-dígitos test: Lead(${l9}) vs Sett(${s9})`)
    }
  } else {
    console.log(`¡ÉXITO! Se han encontrado ${leads.length} coincidencias reales con ingresos vinculados:`)
    leads.slice(0, 10).forEach(l => {
      console.log(`- Lead: ${l.name} | Tel: ${l.phone} | Revenue: €${l.verified_revenue} | Stage: ${l.stage}`)
    })
    if (leads.length > 10) console.log(`... y ${leads.length - 10} más.`)
  }
}

checkResults()
