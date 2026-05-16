const fs = require('fs');
const path = require('path');

// Load from .env.tokens.local as primary source for local scripts
const envPath = path.join(process.cwd(), '.env.tokens.local');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config();
}

const { createClient } = require('@supabase/supabase-js')

const COMMON_NAMES = new Set(['maria', 'jose', 'carmen', 'antonio', 'juan', 'ana', 'manuel', 'pilar', 'del', 'los', 'angeles', 'dolores', 'valle'])

function normalizeName(name) {
  if (!name) return ''
  return name.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^a-z0-9]/g, ' ') // Only alphanumeric
    .split(/\s+/)
    .filter(word => word.length > 2)
    .join(' ')
}

function normalizePhone(phone) {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, '')
  return digits.length >= 9 ? digits.slice(-9) : (digits.length > 0 ? digits : null)
}

async function deepAudit() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase credentials missing. Ensure VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are in .env.tokens.local');
  }
  const supabase = createClient(supabaseUrl, supabaseKey)
  
  console.log('--- AUDITORÍA PROFUNDA DE COINCIDENCIAS (V3) ---')

  // 1. Refresco de esquema (Reload PostgREST cache)
  try {
    await supabase.rpc('reconcile_doctoralia_subjects_to_leads', { p_user_id: '00000000-0000-0000-0000-000000000000' })
  } catch (e) {
    console.log('Aviso: Falló el refresco inicial rpc, continuando...')
  }

  // 2. Obtener leads no convertidos
  const { data: leads } = await supabase.from('leads')
    .select('id, name, phone, notes, clinic_id, stage, appointment_date')
    .is('verified_revenue', null)

  // 3. Obtener settlements
  const { data: setts } = await supabase.from('financial_settlements')
    .select('id, patient_name, patient_phone, template_name, amount_net, intake_at, settled_at')

  console.log(`Analizando ${leads?.length || 0} leads pendientes contra ${setts?.length || 0} liquidaciones...`)

  const matchesFound = []

  for (const l of (leads || [])) {
    let lRawPhone = l.phone
    if (!lRawPhone && l.notes) {
       try {
         const n = typeof l.notes === 'string' ? JSON.parse(l.notes) : l.notes
         lRawPhone = n.telefono || n.phone || n.phone_number
       } catch (e) {}
    }

    const lNameNorm = normalizeName(l.name)
    const lPhoneNorm = normalizePhone(lRawPhone)
    const lWords = lNameNorm.split(' ').filter(w => !COMMON_NAMES.has(w))
    
    for (const s of (setts || [])) {
      let sPhoneNorm = normalizePhone(s.patient_phone)
      if (!sPhoneNorm && s.template_name) {
        const phoneInSubject = s.template_name.match(/(\d{9,15})/g)
        if (phoneInSubject) sPhoneNorm = normalizePhone(phoneInSubject[0])
      }

      const sNameNorm = normalizeName(s.patient_name || s.template_name?.split('[')[0])
      const intersection = lWords.filter(w => sWords.includes(w))
      const sWords = sNameNorm.split(' ')

      let isMatch = false
      let reason = ''

      // Caso A: Coincidencia de teléfono (9 dígitos)
      if (lPhoneNorm && sPhoneNorm && lPhoneNorm.length >= 9 && sPhoneNorm.length >= 9 && lPhoneNorm.slice(-9) === sPhoneNorm.slice(-9)) {
        isMatch = true
        reason = 'Teléfono exacto (9 dígitos)'
      }
      
      // Caso B: Coincidencia de nombre (Apellido o nombre poco común)
      if (!isMatch && lWords.length > 0) {
        if (intersection.length >= 1) {
          if (lNameNorm.length > 12 && intersection.length >= 1) {
             isMatch = true
             reason = `Nombre distintivo (${intersection.join(', ')})`
          } else if (intersection.length >= 2) {
             isMatch = true
             reason = `Nombre y Apellido (${intersection.join(', ')})`
          }
        }
      }

      // Caso C: Coincidencia por Fecha + Nombre Parcial (para registros sin teléfono)
      if (!isMatch && l.appointment_date && s.intake_at && intersection.length >= 1) {
        const lDate = new Date(l.appointment_date).toISOString().split('T')[0];
        const sDate = new Date(s.intake_at).toISOString().split('T')[0];
        if (lDate === sDate) {
          isMatch = true;
          reason = `Fecha coincidente (${lDate}) + Nombre parcial`;
        }
      }

      if (isMatch) {
        matchesFound.push({
          leadId: l.id,
          leadName: l.name,
          leadPhone: lRawPhone || 'N/A',
          settId: s.id,
          settName: s.patient_name || s.template_name,
          amount: s.amount_net,
          reason: reason,
          date: s.intake_at || s.settled_at
        })
        break;
      }
    }
  }

  console.log(`\nSE ENCONTRARON ${matchesFound.length} POTENCIALES COINCIDENCIAS NUEVAS:`)
  for (const m of matchesFound) {
    console.log(`- [${m.reason}] Lead: ${m.leadName} | Sett: ${m.settName} | €${m.amount}`)
    
    // Intento de actualización silenciosa (probamos sin 'stage' si falla con él)
    const updateData = {
      verified_revenue: m.amount,
      appointment_date: m.date,
      updated_at: new Date().toISOString()
    }
    
    const { error } = await supabase.from('leads').update(updateData).eq('id', m.leadId)
    
    if (!error) {
       console.log('  ✅ Actualizado en DB (Ingresos)')
       // Intentamos avanzar el stage por separado para aislar el error
       await supabase.from('leads').update({ stage: 'convertido' }).eq('id', m.leadId)
    } else {
       console.log('  ❌ Error al actualizar:', error.message)
    }
  }
}

deepAudit()
