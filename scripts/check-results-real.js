const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

async function godModeMatch() {
  const supabase = createClient(supabaseUrl, supabaseKey)
  
  console.log('--- GOD MODE MATCHING (SIN RESTRICCIONES) ---')

  // 1. Obtener TODOS los leads y settlements con teléfono (ignorando clínicas por ahora)
  const { data: leads } = await supabase.from('leads').select('id, phone_normalized, clinic_id').not('phone_normalized', 'is', null)
  const { data: setts } = await supabase.from('financial_settlements').select('phone_normalized, amount_net, intake_at, settled_at, clinic_id').not('phone_normalized', 'is', null)

  console.log(`Cargados ${leads?.length} leads y ${setts?.length} settlements.`)

  const revByPhone = {}
  setts?.forEach(s => {
    const p = s.phone_normalized
    if (!revByPhone[p]) revByPhone[p] = { total: 0, date: s.intake_at || s.settled_at, clinic_id: s.clinic_id }
    revByPhone[p].total += (s.amount_net || 0)
  })

  let count = 0
  for (const l of (leads || [])) {
    const m = revByPhone[l.phone_normalized]
    if (m && m.total > 0) {
      console.log(`MATCH ENCONTRADO: Lead ${l.id} | Tel ${l.phone_normalized} | Rev €${m.total}`)
      
      const updateData = {
        verified_revenue: m.total,
        appointment_date: m.date,
        status: 'convertido',
        stage: 'convertido'
      }
      
      // Si el lead no tiene clínica, le ponemos la del settlement
      if (!l.clinic_id && m.clinic_id) {
        updateData.clinic_id = m.clinic_id
      } else if (!l.clinic_id && !m.clinic_id) {
        // Si ninguno tiene, usamos la del env
        updateData.clinic_id = process.env.CLINIC_ID
      }

      await supabase.from('leads').update(updateData).eq('id', l.id)
      count++
    }
  }

  console.log(`¡GOD MODE COMPLETADO! ${count} leads vinculados.`)
}

godModeMatch()
