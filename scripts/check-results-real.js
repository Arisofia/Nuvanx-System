const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function normalize(phone) {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, '')
  return digits.length >= 9 ? digits.slice(-9) : null
}

async function finalMatch() {
  const supabase = createClient(supabaseUrl, supabaseKey)
  
  console.log('--- FINAL CRITICAL MATCHING ---')

  const { data: leads } = await supabase.from('leads').select('id, phone, phone_normalized, notes, clinic_id')
  const { data: setts } = await supabase.from('financial_settlements').select('phone_normalized, amount_net, intake_at, settled_at')

  console.log(`Leads: ${leads?.length} | Settlements: ${setts?.length}`)

  const revByPhone = {}
  setts?.forEach(s => {
    const p = s.phone_normalized
    if (p) {
      if (!revByPhone[p]) revByPhone[p] = { total: 0, date: s.intake_at || s.settled_at }
      revByPhone[p].total += (s.amount_net || 0)
    }
  })

  let count = 0
  for (const l of (leads || [])) {
    // Probar todas las fuentes de teléfono posibles para el lead
    const candidates = [
      l.phone_normalized,
      normalize(l.phone),
      normalize(l.notes?.telefono),
      normalize(l.notes?.phone)
    ]
    
    const norm = candidates.find(c => c && revByPhone[c])
    
    if (norm) {
      const m = revByPhone[norm]
      console.log(`VINCULANDO: Lead ${l.id} | Tel ${norm} | Revenue €${m.total}`)
      
      await supabase.from('leads').update({
        verified_revenue: m.total,
        appointment_date: m.date,
        status: 'convertido',
        stage: 'convertido',
        phone_normalized: norm
      }).eq('id', l.id)
      count++
    }
  }

  console.log(`VINCULACIÓN COMPLETADA: ${count} registros actualizados.`)
}

finalMatch()
