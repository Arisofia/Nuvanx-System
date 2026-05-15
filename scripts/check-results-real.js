const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const clinicId = process.env.CLINIC_ID

async function checkResults() {
  const supabase = createClient(supabaseUrl, supabaseKey)
  
  console.log('--- DIAGNÓSTICO FINAL DE ATRIBUCIÓN (9 DÍGITOS) ---')

  // 1. Mostrar estado de los datos
  const { count: totalLeads } = await supabase.from('leads').select('*', { count: 'exact', head: true }).eq('clinic_id', clinicId)
  const { count: totalSettlements } = await supabase.from('financial_settlements').select('*', { count: 'exact', head: true }).eq('clinic_id', clinicId)
  
  console.log(`- Leads en base: ${totalLeads}`)
  console.log(`- Settlements (Doctoralia): ${totalSettlements}`)

  // 2. Ejecutar Matching RPC (ahora con la tabla correcta)
  console.log('Ejecutando matching por teléfono (9 dígitos)...')
  const { data: matchedRows } = await supabase.rpc('reconcile_doctoralia_subjects_to_leads', { 
    p_user_id: process.env.WEBHOOK_ADMIN_USER_ID || '00000000-0000-0000-0000-000000000000' 
  })
  console.log(`Matching disparado: ${matchedRows} registros actualizados.`)

  // 3. Mostrar Leads con Ingresos
  const { data: leads, error } = await supabase
    .from('leads')
    .select('name, phone, phone_normalized, verified_revenue, stage')
    .eq('clinic_id', clinicId)
    .not('verified_revenue', 'is', null)
    .gt('verified_revenue', 0)

  if (leads && leads.length > 0) {
    console.log(`¡ÉXITO! Se han vinculado ${leads.length} coincidencias reales:`)
    leads.forEach(l => {
      console.log(`- Lead: ${l.name} | Tel: ${l.phone} (Norm: ${l.phone_normalized}) | Revenue: €${l.verified_revenue} | Stage: ${l.stage}`)
    })
  } else {
    console.log('No se encontraron leads con ingresos verificados.')
    
    // Ver si hay teléfonos normalizados en ambos lados
    const { data: lPhones } = await supabase.from('leads').select('phone_normalized').eq('clinic_id', clinicId).not('phone_normalized', 'is', null).limit(5)
    const { data: sPhones } = await supabase.from('financial_settlements').select('phone_normalized').eq('clinic_id', clinicId).not('phone_normalized', 'is', null).limit(5)
    
    console.log('Muestra Teléfonos Normalizados Leads:', lPhones?.map(p => p.phone_normalized))
    console.log('Muestra Teléfonos Normalizados Settlements:', sPhones?.map(p => p.phone_normalized))
    
    // Ver un ejemplo de template_name para confirmar regex
    const { data: templateSample } = await supabase.from('financial_settlements').select('template_name').eq('clinic_id', clinicId).limit(3)
    console.log('Muestra Template Names (Settlements):', templateSample?.map(t => t.template_name))
  }
}

checkResults()
