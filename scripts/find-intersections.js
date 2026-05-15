const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

async function findIntersections() {
  const supabase = createClient(supabaseUrl, supabaseKey)
  
  console.log('--- BUSCANDO INTERSECCIÓN DE TELÉFONOS ---')

  const { data: leadPhones } = await supabase.from('leads').select('phone_normalized').not('phone_normalized', 'is', null)
  const { data: settPhones } = await supabase.from('financial_settlements').select('phone_normalized').not('phone_normalized', 'is', null)
  
  const lSet = new Set(leadPhones.map(l => l.phone_normalized))
  const sSet = new Set(settPhones.map(s => s.phone_normalized))
  
  const intersection = [...lSet].filter(x => sSet.has(x))
  
  console.log(`Teléfonos únicos en Leads: ${lSet.size}`)
  console.log(`Teléfonos únicos en Settlements: ${sSet.size}`)
  console.log(`INTERSECCIÓN ENCONTRADA: ${intersection.length} teléfonos coinciden.`)
  
  if (intersection.length > 0) {
    console.log('Ejemplos de coincidencia:', intersection.slice(0, 5))
  } else {
    console.log('No hay coincidencias exactas de 9 dígitos.')
    // Ver si hay coincidencias parciales (8 dígitos o algo así por errores de prefijo)
    console.log('Buscando coincidencias de 8 dígitos...')
    const lSet8 = new Set(leadPhones.map(l => l.phone_normalized.slice(-8)))
    const sSet8 = new Set(settPhones.map(s => s.phone_normalized.slice(-8)))
    const intersection8 = [...lSet8].filter(x => sSet8.has(x))
    console.log(`INTERSECCIÓN 8 DÍGITOS: ${intersection8.length} coincidencias.`)
  }
}

findIntersections()
