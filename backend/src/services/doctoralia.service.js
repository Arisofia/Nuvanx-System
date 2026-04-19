'use strict';

/**
 * Doctoralia data service.
 *
 * Extracts the shared business logic from the doctoralia route so it can be
 * reused by both the synchronous /ingest endpoint and the asynchronous /batch
 * endpoint (run as a step inside the playbook runner).
 *
 * Exports:
 *   parseName(raw)                           — normalise "Apellido, Nombre" format
 *   parseAmount(raw)                         — parse Spanish-format currency strings
 *   parseDate(raw)                           — accept ISO or DD/MM/YYYY dates
 *   CANCELLED_ESTADOS                        — Set of estado values meaning cancelled
 *   ingestRows(clinicId, rows) → { inserted, updated, patientsUpserted, errors }
 */

const { pool } = require('../db');
const logger = require('../utils/logger');

// Estado values that indicate a cancelled operation
const CANCELLED_ESTADOS = new Set(['cancelado', 'cancelled', 'anulado', 'void', 'baja']);

function parseName(raw) {
  if (!raw) return '';
  const str = raw.trim();
  // Doctoralia format: "Apellido1 Apellido2, Nombre"
  if (str.includes(',')) {
    const [surnames, given] = str.split(',').map((s) => s.trim());
    return [given, surnames].filter(Boolean).join(' ');
  }
  return str;
}

function parseAmount(raw) {
  if (raw == null || raw === '') return 0;
  // Remove currency symbols, spaces; convert comma decimal to dot
  const cleaned = String(raw).replace(/[€$\s]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(raw) {
  if (!raw) return null;
  // Accept ISO (2026-01-15) or ES format (15/01/2026)
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
    const [d, m, y] = s.split('/');
    return `${y}-${m}-${d}`;
  }
  return null;
}

/**
 * Transactionally ingest an array of Doctoralia rows for the given clinic.
 *
 * Acquires a dedicated pg client, runs each row inside a SAVEPOINT so that a
 * single bad row does not abort the whole batch, then fires reconciliation
 * asynchronously after the transaction commits.
 *
 * @param {string} clinicId
 * @param {Array}  rows     Raw Doctoralia export row objects
 * @returns {{ inserted: number, updated: number, patientsUpserted: number, errors: Array }}
 */
async function ingestRows(clinicId, rows) {
  let inserted = 0;
  let updated = 0;
  let patientsUpserted = 0;
  const rowErrors = [];
  const patientIdsToReconcile = [];

  // Acquire a dedicated client so all transaction commands run on the same connection
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      for (const row of rows) {
        await client.query('SAVEPOINT sp');
        try {
          const opId = String(row.idoperacion || '').trim();
          if (!opId) {
            rowErrors.push({ row, reason: 'missing idoperacion' });
            await client.query('RELEASE SAVEPOINT sp');
            continue;
          }

          const patientName = parseName(row.paciente || row.nombre || '');
          const dni = row.dni ? String(row.dni).trim().toUpperCase() : null;
          const templateId = row.plantillaid ? String(row.plantillaid).trim() : null;
          const templateName = row.plantilladescr ? String(row.plantilladescr).trim() : null;
          const amountGross = parseAmount(row.importebruto);
          const amountDiscount = parseAmount(row.importedescuento);
          const amountNet = parseAmount(row.importeneto);
          const settledAt = parseDate(row.fechaoperacion);
          const intakeAt = parseDate(row.fechaentrada);
          const paymentMethod = row.metodopago ? String(row.metodopago).trim() : null;
          const isCancelled = CANCELLED_ESTADOS.has((row.estado || '').toLowerCase().trim());
          const cancelledAt = isCancelled ? (settledAt || new Date().toISOString().slice(0, 10)) : null;

          if (!settledAt) {
            rowErrors.push({ row: opId, reason: 'missing or invalid fechaoperacion' });
            await client.query('RELEASE SAVEPOINT sp');
            continue;
          }

          // Upsert patient — uses the clinic-scoped unique index on (clinic_id, dni)
          let patientId = null;
          if (patientName) {
            const patRes = await client.query(
              `INSERT INTO patients (clinic_id, name, dni)
               VALUES ($1, $2, $3)
               ON CONFLICT (clinic_id, dni) WHERE dni IS NOT NULL DO UPDATE
                 SET name = EXCLUDED.name, updated_at = NOW()
               RETURNING id`,
              [clinicId, patientName, dni],
            );
            patientId = patRes.rows[0]?.id || null;
            patientsUpserted += 1;
          }

          // Upsert settlement
          const upsertRes = await client.query(
            `INSERT INTO financial_settlements
               (id, clinic_id, patient_id, template_id, template_name,
                amount_gross, amount_discount, amount_net,
                payment_method, settled_at, intake_at, cancelled_at,
                source_system)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'doctoralia')
             ON CONFLICT (id) DO UPDATE SET
               patient_id      = COALESCE(EXCLUDED.patient_id, financial_settlements.patient_id),
               template_id     = COALESCE(EXCLUDED.template_id, financial_settlements.template_id),
               template_name   = COALESCE(EXCLUDED.template_name, financial_settlements.template_name),
               amount_gross    = EXCLUDED.amount_gross,
               amount_discount = EXCLUDED.amount_discount,
               amount_net      = EXCLUDED.amount_net,
               payment_method  = COALESCE(EXCLUDED.payment_method, financial_settlements.payment_method),
               intake_at       = COALESCE(EXCLUDED.intake_at, financial_settlements.intake_at),
               cancelled_at    = EXCLUDED.cancelled_at
             RETURNING (xmax = 0) AS is_insert`,
            [opId, clinicId, patientId, templateId, templateName,
              amountGross, amountDiscount, amountNet,
              paymentMethod, settledAt, intakeAt, cancelledAt],
          );

          if (upsertRes.rows[0]?.is_insert) {
            inserted += 1;
          } else {
            updated += 1;
          }

          await client.query('RELEASE SAVEPOINT sp');

          // Collect patients to reconcile after the transaction commits
          if (patientId) {
            patientIdsToReconcile.push(patientId);
          }
        } catch (rowErr) {
          await client.query('ROLLBACK TO SAVEPOINT sp');
          const opId = row.idoperacion || '?';
          logger.warn('doctoralia service: row error', { opId, error: rowErr.message });
          rowErrors.push({ row: opId, reason: rowErr.message });
        }
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    }
  } finally {
    client.release();
  }

  // Fire-and-forget lead reconciliation after the transaction completes.
  // reconcile_patient_leads(patient_id) finds unlinked leads by
  // dni_hash/phone_normalized and links them to this patient.
  for (const patientId of patientIdsToReconcile) {
    pool.query(
      'SELECT reconcile_patient_leads($1)',
      [patientId],
    ).catch((e) => logger.warn('reconcile_patient_leads failed', { patientId, error: e.message }));
  }

  return { inserted, updated, patientsUpserted, errors: rowErrors };
}

module.exports = { parseName, parseAmount, parseDate, CANCELLED_ESTADOS, ingestRows };
