'use strict';

/**
 * /api/doctoralia — Doctoralia settlement data ingestion
 *
 * POST /api/doctoralia/ingest
 *   Accepts an array of rows in Doctoralia export format, upserts patients
 *   and financial_settlements, then runs reconcile_lead_to_patient() for each
 *   newly inserted patient.
 *
 * Column mapping (Doctoralia → DB):
 *   idoperacion      → financial_settlements.id
 *   paciente         → patient name (parsed from "Apellido1 Apellido2, Nombre" or "Nombre Apellido")
 *   dni              → patients.dni
 *   plantillaid      → financial_settlements.template_id
 *   plantilladescr   → financial_settlements.template_name
 *   importebruto     → financial_settlements.amount_gross
 *   importedescuento → financial_settlements.amount_discount
 *   importeneto      → financial_settlements.amount_net
 *   fechaoperacion   → financial_settlements.settled_at
 *   fechaentrada     → financial_settlements.intake_at
 *   metodopago       → financial_settlements.payment_method
 *   estado           → cancelled_at if value indicates cancellation
 *
 * Request body: { rows: [ {...}, ... ] }
 * Response: { inserted: N, updated: N, patients_upserted: N, errors: [...] }
 *
 * Only authenticated users whose clinic_id is set can ingest.
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { pool, isAvailable } = require('../db');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

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
  // Remove currency symbols, spaces, convert comma decimal to dot
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

router.post(
  '/ingest',
  [
    body('rows').isArray({ min: 1, max: 5000 }).withMessage('rows must be a non-empty array (max 5000)'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    if (!isAvailable()) {
      return res.status(503).json({ success: false, message: 'Database not available' });
    }

    try {
      // Resolve clinic_id
      const { rows: userRows } = await pool.query(
        'SELECT clinic_id FROM users WHERE id = $1',
        [req.user.id],
      );
      const clinicId = userRows[0]?.clinic_id || null;
      if (!clinicId) {
        return res.status(400).json({
          success: false,
          message: 'Your account is not linked to a clinic. Set clinic_id on the users row first.',
        });
      }

      const { rows: inputRows } = req.body;
      let inserted = 0;
      let updated = 0;
      let patientsUpserted = 0;
      const rowErrors = [];

      for (const row of inputRows) {
        try {
          const opId = String(row.idoperacion || '').trim();
          if (!opId) { rowErrors.push({ row, reason: 'missing idoperacion' }); continue; }

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

          if (!settledAt) { rowErrors.push({ row: opId, reason: 'missing or invalid fechaoperacion' }); continue; }

          // Upsert patient
          let patientId = null;
          if (patientName) {
            const patRes = await pool.query(
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
          const upsertRes = await pool.query(
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

          // Run reconcile_lead_to_patient for newly inserted patients (best-effort)
          if (patientId) {
            pool.query(
              'SELECT reconcile_lead_to_patient($1)',
              [patientId],
            ).catch((e) => logger.warn('reconcile_lead_to_patient failed', { patientId, error: e.message }));
          }
        } catch (rowErr) {
          const opId = row.idoperacion || '?';
          logger.warn('doctoralia ingest: row error', { opId, error: rowErr.message });
          rowErrors.push({ row: opId, reason: rowErr.message });
        }
      }

      logger.info('Doctoralia ingest complete', {
        userId: req.user.id, clinicId, inserted, updated, patientsUpserted, errors: rowErrors.length,
      });

      res.json({
        success: true,
        inserted,
        updated,
        patients_upserted: patientsUpserted,
        errors: rowErrors,
      });
    } catch (err) {
      logger.error('doctoralia ingest error', { userId: req.user.id, error: err.message });
      next(err);
    }
  },
);

module.exports = router;
