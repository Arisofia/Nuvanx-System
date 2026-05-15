const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const clinicId = process.env.CLINIC_ID

async function checkResults() {
  const supabase = createClient(supabaseUrl, supabaseKey)
  
  console.log('--- REPARACIÓN Y DIAGNÓSTICO AGRESIVO (9 DÍGITOS) ---')

  // 1. Intentar extraer teléfonos de 'notes' en LEADS
  console.log('Reparando leads...')
  const { data: leadsToRepair } = await supabase
    .from('leads')
    .select('id, notes, phone')
    .eq('clinic_id', clinicId)
    .is('phone', null)
    .not('notes', 'is', null)

  let leadRepairedCount = 0
  for (const lead of (leadsToRepair || [])) {
    try {
      const notes = typeof lead.notes === 'string' ? JSON.parse(lead.notes) : lead.notes
      const phone = notes.telefono || notes.phone || notes.phone_number || notes.phoneNumber
      if (phone) {
        await supabase.from('leads').update({ phone: String(phone) }).eq('id', lead.id)
        leadRepairedCount++
      }
    } catch (e) {}
  }
  console.log(`Leads reparados desde JSON notes: ${leadRepairedCount}`)

  // 2. Extraer teléfonos de 'asunto' en SETTLEMENTS
  console.log('Reparando doctoralia_settlements...')
  const { data: settsToRepair } = await supabase
    .from('doctoralia_settlements')
    .select('id, asunto, paciente_telefono')
    .eq('clinic_id', clinicId)

  let settRepairedCount = 0
  for (const sett of (settsToRepair || [])) {
    if (!sett.paciente_telefono || sett.paciente_telefono.length < 9) {
      const match = sett.asunto?.match(/(\d{9})/g)
      if (match) {
        await supabase.from('doctoralia_settlements').update({ paciente_telefono: match[0] }).eq('id', sett.id)
        settRepairedCount++
      }
    }
  }
  console.log(`Settlements reparados desde asunto: ${settRepairedCount}`)

  // 3. Ejecutar Matching RPC
  console.log('Ejecutando matching por teléfono (9 dígitos)...')
  const { data: matchedCount } = await supabase.rpc('reconcile_by_phone_9_digits', { p_clinic_id: clinicId })
  console.log(`Matching finalizado: ${matchedCount} vinculaciones realizadas.`)

  // 4. Mostrar Resultados
  const { data: leadsFinal, error } = await supabase
    .from('leads')
    .select('name, phone, external_id, status')
    .eq('clinic_id', clinicId)
    .not('external_id', 'is', null)

  if (leadsFinal && leadsFinal.length > 0) {
    console.log(`¡ÉXITO! Se han vinculado ${leadsFinal.length} leads con registros de Doctoralia:`)
    leadsFinal.forEach(l => {
      console.log(`- Lead: ${l.name} | Tel: ${l.phone} | Status: ${l.status}`)
    })
  } else {
    console.log('No se encontraron vinculaciones directas después de la reparación.')
    
    // Muestra de datos para entender por qué fallan
    const { data: lSample } = await supabase.from('leads').select('name, phone').eq('clinic_id', clinicId).not('phone', 'is', null).limit(3)
    const { data: sSample } = await supabase.from('doctoralia_settlements').select('asunto, paciente_telefono').eq('clinic_id', clinicId).limit(3)
    
    console.log('Muestra Leads:', lSample)
    console.log('Muestra Settlements:', sSample)
  }
}

checkResults()
