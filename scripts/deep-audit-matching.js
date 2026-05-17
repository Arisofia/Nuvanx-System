const fs = require('node:fs');
const path = require('node:path');

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
  if (digits.length >= 9) return digits.slice(-9)
  return digits.length > 0 ? digits : null
}

function getLeadPhone(l) {
  let lRawPhone = l.phone
  if (!lRawPhone && l.notes) {
     try {
       const n = typeof l.notes === 'string' ? JSON.parse(l.notes) : l.notes
       lRawPhone = n.telefono || n.phone || n.phone_number
     } catch (e) {
       // Silently ignore parsing errors in notes
     }
  }
  return lRawPhone
}

function matchPhone(p1, p2) {
  return p1 && p2 && p1 === p2 && p1.length >= 9;
}

function matchName(lWords, lNameNorm, intersection) {
  if (intersection.length >= 2) {
    return { isMatch: true, reason: `Coincidencia de nombres (${intersection.join(', ')})` };
  }
  return null;
}

function matchDate(l, s, intersection) {
  // If we have at least 1 word match and dates are close
  if (intersection.length >= 1) {
    const leadDateStr = l.appointment_date || l.created_at;
    if (!leadDateStr) return null;
    const lDate = new Date(leadDateStr);
    const sDate = new Date(s.intake_at || s.settled_at);
    const diffDays = Math.abs(sDate - lDate) / (1000 * 60 * 60 * 24);
    if (diffDays <= 30) {
      return { isMatch: true, reason: `Nombre parcial + Fecha próxima (${Math.round(diffDays)} días)` };
    }
  }
  return null;
}

function evaluateMatch(l, s, context) {
  const { lPhoneNorm, lWords, lNameNorm } = context
  
  let sPhoneNorm = normalizePhone(s.patient_phone)
  if (!sPhoneNorm && s.template_name) {
    const phoneInSubject = s.template_name.match(/(\d{9,15})/g)
    if (phoneInSubject) sPhoneNorm = normalizePhone(phoneInSubject[0])
  }

  const sNameNorm = normalizeName(s.patient_name || s.template_name?.split('[')[0])
  const sWords = new Set(sNameNorm.split(' '))
  const intersection = lWords.filter(w => sWords.has(w))

  if (matchPhone(lPhoneNorm, sPhoneNorm)) {
    return { isMatch: true, reason: 'Teléfono exacto (9 dígitos)' }
  }
  
  const nameResult = matchName(lWords, lNameNorm, intersection);
  if (nameResult) return nameResult;

  const dateResult = matchDate(l, s, intersection);
  if (dateResult) return dateResult;

  return { isMatch: false }
}

function findMatchForLead(l, setts) {
  const lRawPhone = getLeadPhone(l)
  const lNameNorm = normalizeName(l.name)
  const lPhoneNorm = normalizePhone(lRawPhone)
  const lWords = lNameNorm.split(' ').filter(w => !COMMON_NAMES.has(w))
  
  const context = { lRawPhone, lNameNorm, lPhoneNorm, lWords }

  for (const s of (setts || [])) {
    const result = evaluateMatch(l, s, context)
    if (result.isMatch) {
      return {
        leadId: l.id,
        leadName: l.name,
        leadPhone: lRawPhone || 'N/A',
        settId: s.id,
        settName: s.patient_name || s.template_name,
        amount: s.amount_net,
        reason: result.reason,
        date: s.intake_at || s.settled_at
      }
    }
  }
  return null
}

async function processMatches(matchesFound, supabase) {
  console.log(`\nSE ENCONTRARON ${matchesFound.length} POTENCIALES COINCIDENCIAS NUEVAS:`)
  for (const m of matchesFound) {
    console.log(`- [${m.reason}] Lead: ${m.leadName} | Sett: ${m.settName} | €${m.amount}`)
    
    const updateData = {
      verified_revenue: m.amount,
      appointment_date: m.date,
      updated_at: new Date().toISOString()
    }
    
    const { error } = await supabase.from('leads').update(updateData).eq('id', m.leadId)
    
    if (error) {
       console.log('  ❌ Error al actualizar:', error.message)
    } else {
       console.log('  ✅ Actualizado en DB (Ingresos)')
       await supabase.from('leads').update({ stage: 'convertido' }).eq('id', m.leadId)
    }
  }
}

async function deepAudit() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase credentials missing. Ensure VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are in .env.tokens.local');
  }
  const supabase = createClient(supabaseUrl, supabaseKey)
  
  console.log('--- AUDITORÍA PROFUNDA DE COINCIDENCIAS (V3) ---')
  console.log(`Auditing target: ${supabaseUrl}`);

  // 1. Refresco de esquema (Reload PostgREST cache)
  try {
    await supabase.rpc('reconcile_doctoralia_subjects_to_leads', { p_user_id: '00000000-0000-0000-0000-000000000000' })
  } catch (e) {
    // Diagnostic S2486: RPC reload failure is non-fatal; continuing with audit
    console.warn('Aviso: Falló el refresco inicial rpc, continuando...')
  }

  // 2. Obtener leads no convertidos
  const { data: leads } = await supabase.from('leads')
    .select('id, name, phone, notes, clinic_id, stage, appointment_date, created_at')
    .is('verified_revenue', null)

  // 3. Obtener settlements
  const { data: setts } = await supabase.from('financial_settlements')
    .select('id, patient_name, patient_phone, template_name, amount_net, intake_at, settled_at')

  console.log(`Analizando ${leads?.length || 0} leads pendientes contra ${setts?.length || 0} liquidaciones...`)

  const matchesFound = []

  for (const l of (leads || [])) {
    const match = findMatchForLead(l, setts)
    if (match) matchesFound.push(match)
  }

  await processMatches(matchesFound, supabase)
}

deepAudit()
