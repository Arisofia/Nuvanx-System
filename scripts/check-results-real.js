const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function normalize(phone) {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, '')
  return digits.length >= 9 ? digits.slice(-9) : null
}

async function definitiveMatch() {
  const supabase = createClient(supabaseUrl, supabaseKey)
  
  console.log('--- DEFINITIVE MATCHING (9-DIGITS + JSON NOTES) ---')

  const { data: leads } = await supabase.from('leads').select('id, phone, notes, clinic_id')
  const { data: setts } = await supabase.from('financial_settlements').select('id, patient_phone, template_name, amount_net, intake_at, settled_at, clinic_id')

  console.log(`Leads totales: ${leads?.length}`)
  console.log(`Settlements totales: ${setts?.length}`)

  // 1. Extraer y normalizar teléfonos de settlements
  const revByPhone = {}
  setts?.forEach(s => {
    let rawPhone = s.patient_phone
    if (!rawPhone || rawPhone.length < 9) {
      const match = s.template_name?.match(/(\d{9})/g)
      if (match) rawPhone = match[0]
    }

    const norm = normalize(rawPhone)
    if (norm) {
      if (!revByPhone[norm]) revByPhone[norm] = { total: 0, date: s.intake_at || s.settled_at, clinic_id: s.clinic_id }
      revByPhone[norm].total += (s.amount_net || 0)
    }
  })

  // 2. Cruzar con Leads (buscando en phone y en notes)
  let matchCount = 0
  for (const l of (leads || [])) {
    let rawLeadPhone = l.phone
    
    // Si no hay phone, buscar en notes
    if (!rawLeadPhone && l.notes) {
      try {
        const n = typeof l.notes === 'string' ? JSON.parse(l.notes) : l.notes
        rawLeadPhone = n.telefono || n.phone || n.phone_number
      } catch (e) {}
    }

    const norm = normalize(rawLeadPhone)
    if (norm && revByPhone[norm] && revByPhone[norm].total > 0) {
      const m = revByPhone[norm]
      console.log(`¡¡MATCH!! Lead ${l.id} | Tel ${norm} | Revenue €${m.total}`)
      
      const updateData = {
        verified_revenue: m.total,
        appointment_date: m.date,
        status: 'convertido',
        stage: 'convertido',
        phone: rawLeadPhone, // Rellenamos la columna phone si estaba vacía
        phone_normalized: norm
      }
      
      await supabase.from('leads').update(updateData).eq('id', l.id)
      matchCount++
    }
  }

  console.log(`VINCULACIÓN FINALIZADA: ${matchCount} leads vinculados con ingresos reales.`)
}

definitiveMatch()
