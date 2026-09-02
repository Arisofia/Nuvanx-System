const fs = require('fs');

let content = fs.readFileSync('scripts/sync-doctoralia.js', 'utf8');

// 1. Add required imports
const importCode = `const {
  buildDoctoraliaPatientId,
  buildSettlementId,
} = require('./lib/doctoralia-settlement-identity');\n`;
content = content.replace(/(const \{[^}]+\}\s*=\s*require\('\.\/lib\/phone-normalization'\);)/, "$1\n" + importCode);

// 2. Remove reconcileDoctoraliaLeads function definition
content = content.replace(/async function reconcileDoctoraliaLeads[\s\S]*?^}/m, '');

// 3. Remove deriveRawId definition
content = content.replace(/function deriveRawId[\s\S]*?^}/m, '');

// 4. Remove getRowId definition
content = content.replace(/function getRowId[\s\S]*?^}/m, '');

// 5. Remove reconcileDoctoraliaLeads invocation
content = content.replace(/\s*\/\/ ── 5\. Reconcile subjects to leads ──────────────────────────────────────\s*await reconcileDoctoraliaLeads\(db\);/g, '');

// 6. Update upsertDoctoraliaRow
const oldUpsertStart = `  const rawId = deriveRawId(row, useHashId, cols);
  if (rawId === '') return false;`;

const newUpsertCode = `  const sourceRecordId = cols.hasColId ? normalizeField(row[cols.colId]) : '';`;

content = content.replace(oldUpsertStart, newUpsertCode);

// After parsing everything, we need to construct the IDs right before the try block.
const tryBlockStart = `  // SKIP rows that still lack basic identification after parsing
  if (!patientName || patientName.length < 2) {
    console.warn(\`[sync-doctoralia] Skipping row \${i + 1} because patient name is missing or too short.\`);
    return false;
  }

  try {`;

const newTryBlockStart = `  const patientId = buildDoctoraliaPatientId({
    clinicId: CLINIC_ID,
    patientDni: null, // DNI is not explicitly parsed in current export columns unless added later
    phoneNormalized: patientPhone,
  });

  if (!patientId) {
    return false;
  }

  const rawId = buildSettlementId({
    clinicId: CLINIC_ID,
    sourceRecordId,
    patientId,
    intakeAt,
    settledAt,
    templateId: tmplId,
    templateName: tmplName,
    amountGross: finalAmountGross,
    amountDiscount: finalAmountDisc,
    amountNet: finalAmountNet,
    paymentMethod: payment,
    intermediaryId: null,
    intermediaryName: intermed,
    agendaName: agenda,
    roomId,
  });

  if (!rawId) {
    return false;
  }

  try {`;

content = content.replace(tryBlockStart, newTryBlockStart);

// Update INSERT query
const oldInsert = `         (id, clinic_id, amount_gross, amount_discount, amount_net,
          payment_method, template_name, template_id,
          settled_at, intake_at, cancelled_at, intermediary_name,
          status_original, status_type, room_id, lead_source, agenda_name,
          patient_phone, phone_normalized, patient_name, source_system)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'doctoralia')
       ON CONFLICT (id) DO UPDATE SET`;

const newInsert = `         (id, clinic_id, amount_gross, amount_discount, amount_net,
          payment_method, template_name, template_id,
          settled_at, intake_at, cancelled_at, intermediary_name,
          status_original, status_type, room_id, lead_source, agenda_name,
          patient_phone, phone_normalized, patient_name, source_system,
          source_record_id, source_key_version, doctoralia_patient_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'doctoralia',$21,2,$22)
       ON CONFLICT (id) DO UPDATE SET
         source_record_id = EXCLUDED.source_record_id,
         source_key_version = EXCLUDED.source_key_version,
         doctoralia_patient_key = EXCLUDED.doctoralia_patient_key,`;

content = content.replace(oldInsert, newInsert);

// Update query arguments
const oldArgs = `        patientPhone ? normalizePhoneForMatching(patientPhone) : null,
        patientName,
      ]`;

const newArgs = `        patientPhone ? normalizePhoneForMatching(patientPhone) : null,
        patientName,
        sourceRecordId,
        patientId
      ]`;

content = content.replace(oldArgs, newArgs);

// Also remove from module.exports
content = content.replace(/\s*deriveRawId,/, '');
content = content.replace(/\s*getRowId,/, '');

fs.writeFileSync('scripts/sync-doctoralia.js', content, 'utf8');
console.log('Done refactoring sync-doctoralia.js');
