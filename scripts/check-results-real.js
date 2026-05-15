const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const clinicId = process.env.CLINIC_ID

async function forceMatch() {
  const supabase = createClient(supabaseUrl, supabaseKey)
  
  console.log('--- FORZANDO CRUCE DIRECTO DESDE SCRIPT ---')

  // 1. Obtener todos los leads con teléfono normalizado
  const { data: leads } = await supabase
    .from('leads')
    .select('id, phone_normalized, clinic_id')
    .eq('clinic_id', clinicId)
    .not('phone_normalized', 'is', null)

  // 2. Obtener todos los settlements con teléfono normalizado
  const { data: settlements } = await supabase
    .from('financial_settlements')
    .select('phone_normalized, amount_net, intake_at, settled_at')
    .eq('clinic_id', clinicId)
    .not('phone_normalized', 'is', null)

  if (!leads || !settlements) {
    console.log('Faltan datos para el cruce.')
    return
  }

  // 3. Agrupar ingresos por teléfono
  const revenueByPhone = {}
  settlements.forEach(s => {
    const phone = s.phone_normalized
    if (!revenueByPhone[phone]) {
      revenueByPhone[phone] = { total: 0, firstDate: s.intake_at || s.settled_at }
    }
    revenueByPhone[phone].total += (s.amount_net || 0)
  })

  // 4. Actualizar leads que coincidan
  let matchCount = 0
  for (const lead of leads) {
    const match = revenueByPhone[lead.phone_normalized]
    if (match && match.total > 0) {
      console.log(`Vinculando Lead ID ${lead.id} (Tel: ${lead.phone_normalized}) con €${match.total}`)
      await supabase
        .from('leads')
        .update({
          verified_revenue: match.total,
          appointment_date: match.firstDate,
          status: 'convertido',
          stage: 'convertido'
        })
        .eq('id', lead.id)
      matchCount++
    }
  }

  console.log(`PROCESO COMPLETADO: ${matchCount} leads vinculados con éxito.`)
}

forceMatch()
