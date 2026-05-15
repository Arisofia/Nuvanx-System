const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function normalizeName(name) {
  if (!name) return ''
  return name.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^a-z0-9]/g, ' ') // Only alphanumeric
    .split(/\s+/)
    .filter(word => word.length > 2) // Filter short words
    .sort()
    .join(' ')
}

function normalizePhone(phone) {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, '')
  return digits.length >= 9 ? digits.slice(-9) : (digits.length > 0 ? digits : null)
}

async function deepAudit() {
  const supabase = createClient(supabaseUrl, supabaseKey)
  
  console.log('--- AUDITORÍA PROFUNDA DE COINCIDENCIAS ---')

  // 1. Obtener leads no convertidos
  const { data: leads } = await supabase.from('leads')
    .select('id, name, phone, notes, clinic_id')
    .is('verified_revenue', null)

  // 2. Obtener settlements no atribuidos (o todos para mayor seguridad)
  const { data: setts } = await supabase.from('financial_settlements')
    .select('id, patient_name, patient_phone, template_name, amount_net, intake_at, settled_at')

  console.log(`Analizando ${leads?.length} leads pendientes contra ${setts?.length} liquidaciones...`)

  const matchesFound = []

  for (const l of (leads || [])) {
    const lNameNorm = normalizeName(l.name)
    const lPhoneNorm = normalizePhone(l.phone)
    
    // Buscar en settlements
    for (const s of (setts || [])) {
      let sPhoneNorm = normalizePhone(s.patient_phone)
      if (!sPhoneNorm && s.template_name) {
        const phoneInSubject = s.template_name.match(/(\d{7,15})/g)
        if (phoneInSubject) sPhoneNorm = normalizePhone(phoneInSubject[0])
      }

      const sNameNorm = normalizeName(s.patient_name || s.template_name?.split('[')[0])

      let isMatch = false
      let reason = ''

      // Caso A: Coincidencia de teléfono (9 dígitos) - ya deberían estar, pero por si acaso
      if (lPhoneNorm && sPhoneNorm && lPhoneNorm.length >= 9 && sPhoneNorm.length >= 9 && lPhoneNorm.slice(-9) === sPhoneNorm.slice(-9)) {
        isMatch = true
        reason = 'Teléfono exacto (9 dígitos)'
      }
      
      // Caso B: Coincidencia de nombre casi exacta (al menos 2 palabras clave)
      if (!isMatch && lNameNorm && sNameNorm) {
        const lWords = lNameNorm.split(' ')
        const sWords = sNameNorm.split(' ')
        const intersection = lWords.filter(w => sWords.includes(w))
        
        if (intersection.length >= 2) {
          isMatch = true
          reason = `Nombre similar (${intersection.join(', ')})`
        }
      }

      // Caso C: Teléfono parcial (8 dígitos) + Primera palabra del nombre
      if (!isMatch && lPhoneNorm && sPhoneNorm && lPhoneNorm.slice(-8) === sPhoneNorm.slice(-8)) {
        const firstWordL = lNameNorm.split(' ')[0]
        const sWords = sNameNorm.split(' ')
        if (firstWordL && sWords.includes(firstWordL)) {
          isMatch = true
          reason = 'Teléfono 8-dígitos + Nombre'
        }
      }

      if (isMatch) {
        matchesFound.push({
          leadId: l.id,
          leadName: l.name,
          leadPhone: l.phone,
          settId: s.id,
          settName: s.patient_name || s.template_name,
          amount: s.amount_net,
          reason: reason
        })
        break; // Pasamos al siguiente lead si ya encontramos un match para este
      }
    }
  }

  console.log(`\nSE ENCONTRARON ${matchesFound.length} POTENCIALES COINCIDENCIAS NUEVAS:`)
  for (const m of matchesFound) {
    console.log(`- [${m.reason}]`)
    console.log(`  Lead: ${m.leadName} (${m.leadPhone})`)
    console.log(`  Sett: ${m.settName} | Importe: €${m.amount}`)
    
    // Aplicar la actualización directamente
    const { error } = await supabase.from('leads').update({
      verified_revenue: m.amount,
      status: 'convertido',
      stage: 'convertido',
      updated_at: new Date().toISOString()
    }).eq('id', m.leadId)
    
    if (!error) console.log('  ✅ Actualizado en DB')
    else console.log('  ❌ Error al actualizar:', error.message)
  }
}

deepAudit()
