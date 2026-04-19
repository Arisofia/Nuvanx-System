'use strict';

/**
 * /api/doctoralia — Doctoralia settlement data ingestion
 *
 * POST /api/doctoralia/ingest
 *   Synchronous ingest: upserts patients and financial_settlements for up to
 *   5 000 rows, then fires reconcile_patient_leads() for each patient.
 *   Response: { success, inserted, updated, patients_upserted, errors }
 *
 * POST /api/doctoralia/batch
 *   Asynchronous ingest: accepts up to 50 000 rows, returns 202 immediately,
 *   and processes the rows in the background via the durable playbook runner.
 *   Response: { success, message, rowCount }
 *
 * GET /api/doctoralia/unreconciled
 *   Returns financial_settlements for the clinic where no patient was matched
 *   at ingestion time (patient_id IS NULL and not cancelled).
 *   Response: { success, unreconciled: [...], total }
 *
 * Only authenticated users whose account is linked to a clinic can call these
 * endpoints.
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { pool, isAvailable } = require('../db');
const { ingestRows } = require('../services/doctoralia.service');
const playbookRunner = require('../services/playbookRunner');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

// ─── Shared helper ────────────────────────────────────────────────────────────

async function resolveClinicId(userId) {
  const { rows } = await pool.query(
    'SELECT clinic_id FROM users WHERE id = $1',
    [userId],
  );
  return rows[0]?.clinic_id || null;
}

// ─── POST /ingest ─────────────────────────────────────────────────────────────

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
      const clinicId = await resolveClinicId(req.user.id);
      if (!clinicId) {
        return res.status(400).json({
          success: false,
          message: 'Your account is not linked to a clinic. Set clinic_id on the users row first.',
        });
      }

      const { inserted, updated, patientsUpserted, errors: rowErrors } =
        await ingestRows(clinicId, req.body.rows);

      logger.info('Doctoralia ingest complete', {
        userId: req.user.id,
        clinicId,
        inserted,
        updated,
        patientsUpserted,
        errors: rowErrors.length,
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

// ─── POST /batch ──────────────────────────────────────────────────────────────

router.post(
  '/batch',
  [
    body('rows').isArray({ min: 1, max: 50000 }).withMessage('rows must be a non-empty array (max 50000)'),
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
      const clinicId = await resolveClinicId(req.user.id);
      if (!clinicId) {
        return res.status(400).json({
          success: false,
          message: 'Your account is not linked to a clinic. Set clinic_id on the users row first.',
        });
      }

      const { rows } = req.body;
      const userId = req.user.id;

      // Kick off durable background execution and respond immediately
      setImmediate(() => {
        playbookRunner.run({
          playbookSlug: 'doctoralia-batch-ingest',
          userId,
          context: { clinicId, rowCount: rows.length },
          steps: [
            {
              name: 'ingest_rows',
              fn: () => ingestRows(clinicId, rows),
            },
          ],
        }).catch((err) =>
          logger.error('doctoralia batch runner error', { userId, error: err.message }),
        );
      });

      logger.info('Doctoralia batch queued', { userId, clinicId, rowCount: rows.length });

      res.status(202).json({
        success: true,
        message: 'Batch ingestion started',
        rowCount: rows.length,
      });
    } catch (err) {
      logger.error('doctoralia batch error', { userId: req.user.id, error: err.message });
      next(err);
    }
  },
);

// ─── GET /unreconciled ────────────────────────────────────────────────────────

router.get('/unreconciled', async (req, res, next) => {
  try {
    if (!isAvailable()) {
      return res.status(503).json({ success: false, message: 'Database not available' });
    }

    const clinicId = await resolveClinicId(req.user.id);
    if (!clinicId) {
      return res.status(400).json({
        success: false,
        message: 'Your account is not linked to a clinic. Set clinic_id on the users row first.',
      });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    // Return non-cancelled settlements where no patient record was matched
    const { rows } = await pool.query(
      `SELECT
         fs.id,
         fs.amount_net,
         fs.amount_gross,
         fs.amount_discount,
         fs.settled_at,
         fs.intake_at,
         fs.payment_method,
         fs.template_name,
         fs.source_system,
         'no_patient_match'  AS reason_code,
         0::numeric          AS confidence
       FROM financial_settlements fs
       WHERE fs.clinic_id = $1
         AND fs.patient_id IS NULL
         AND fs.cancelled_at IS NULL
       ORDER BY fs.settled_at DESC
       LIMIT $2`,
      [clinicId, limit],
    );

    res.json({
      success: true,
      unreconciled: rows,
      total: rows.length,
    });
  } catch (err) {
    logger.error('doctoralia unreconciled error', { userId: req.user.id, error: err.message });
    next(err);
  }
});

module.exports = router;
