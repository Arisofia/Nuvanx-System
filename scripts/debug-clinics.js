const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

async function debugClinics() {
  const supabase = createClient(supabaseUrl, supabaseKey)
  
  console.log('--- DEBUG DE CLINIC_ID EN INTERSECCIONES ---')

  const { data: leadSample } = await supabase.from('leads').select('phone_normalized, clinic_id').not('phone_normalized', 'is', null)
  const { data: settSample } = await supabase.from('financial_settlements').select('phone_normalized, clinic_id').not('phone_normalized', 'is', null)
  
  const matches = [ '642682091', '661146683', '620557352', '625850854', '632966745' ]
  
  console.log('Analizando ejemplos de coincidencia...')
  matches.forEach(phone => {
    const l = leadSample.find(x => x.phone_normalized === phone)
    const s = settSample.find(x => x.phone_normalized === phone)
    console.log(`Tel: ${phone} | Lead Clinic: ${l?.clinic_id} | Sett Clinic: ${s?.clinic_id}`)
  })
}

debugClinics()
