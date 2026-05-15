const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const clinicId = process.env.CLINIC_ID

async function fixAndMatch() {
  const supabase = createClient(supabaseUrl, supabaseKey)
  
  console.log(`--- REPARANDO CLÍNICAS Y FORZANDO CRUCE (Clínica: ${clinicId}) ---`)

  // 1. Adoptar leads huérfanos
  console.log('Adoptando leads sin clínica...')
  const { error: errL } = await supabase
    .from('leads')
    .update({ clinic_id: clinicId })
    .is('clinic_id', null)
  if (errL) console.error('Error adoptando leads:', errL)

  // 2. Adoptar settlements huérfanos
  console.log('Adoptando settlements sin clínica...')
  const { error: errS } = await supabase
    .from('financial_settlements')
    .update({ clinic_id: clinicId })
    .is('clinic_id', null)
  if (errS) console.error('Error adoptando settlements:', errS)

  // 3. Ejecutar Cruce Directo
  const { data: leads } = await supabase.from('leads').select('id, phone_normalized').eq('clinic_id', clinicId).not('phone_normalized', 'is', null)
  const { data: setts } = await supabase.from('financial_settlements').select('phone_normalized, amount_net, intake_at, settled_at').eq('clinic_id', clinicId).not('phone_normalized', 'is', null)

  const revByPhone = {}
  setts?.forEach(s => {
    const p = s.phone_normalized
    if (!revByPhone[p]) revByPhone[p] = { total: 0, date: s.intake_at || s.settled_at }
    revByPhone[p].total += (s.amount_net || 0)
  })

  let count = 0
  for (const l of (leads || [])) {
    const m = revByPhone[l.phone_normalized]
    if (m && m.total > 0) {
      await supabase.from('leads').update({
        verified_revenue: m.total,
        appointment_date: m.date,
        status: 'convertido',
        stage: 'convertido'
      }).eq('id', l.id)
      count++
    }
  }

  console.log(`¡ÉXITO! ${count} leads vinculados y atribuidos correctamente.`)
}

fixAndMatch()
