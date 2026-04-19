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
const doctoraliaService = require('../services/doctoralia.service');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

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
      const {
        inserted,
        updated,
        patientsUpserted,
        rowErrors,
      } = await doctoraliaService.ingestRows({ rows: inputRows, clinicId });

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
