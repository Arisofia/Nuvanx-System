'use strict';

/**
 * /api/financials — Doctoralia-verified financial data
 *
 * GET /api/financials/summary     — KPI summary + monthly chart + template mix
 * GET /api/financials/settlements — paginated settlement list (with patient join)
 * GET /api/financials/patients    — patient LTV table
 *
 * All queries are scoped to req.user's clinic_id.  If the user has no
 * clinic_id, empty results are returned (no error) so the UI renders cleanly.
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { pool, isAvailable } = require('../db');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

// ─── helper: resolve user's clinic_id ────────────────────────────────────────

async function getClinicId(userId) {
  if (!isAvailable()) return null;
  try {
    const { rows } = await pool.query(
      'SELECT clinic_id FROM users WHERE id = $1',
      [userId],
    );
    return rows[0]?.clinic_id || null;
  } catch (err) {
    logger.warn('financials: could not resolve clinic_id', { userId, error: err.message });
    return null;
  }
}

// ─── GET /api/financials/summary ─────────────────────────────────────────────

router.get('/summary', async (req, res, next) => {
  try {
    if (!isAvailable()) {
      return res.json({
        summary: { totalNet: 0, totalGross: 0, totalDiscount: 0, avgTicket: 0, settledCount: 0, cancelledCount: 0, discountRate: 0, avgLiquidationDays: 0 },
        monthly: [],
        templateMix: [],
      });
    }

    const clinicId = await getClinicId(req.user.id);
    if (!clinicId) {
      return res.json({
        summary: { totalNet: 0, totalGross: 0, totalDiscount: 0, avgTicket: 0, settledCount: 0, cancelledCount: 0, discountRate: 0, avgLiquidationDays: 0 },
        monthly: [],
        templateMix: [],
      });
    }

    const [summaryRes, monthlyRes, templateRes] = await Promise.all([
      // Aggregate KPIs
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE cancelled_at IS NULL)     AS settled_count,
           COUNT(*) FILTER (WHERE cancelled_at IS NOT NULL) AS cancelled_count,
           COALESCE(SUM(amount_net)      FILTER (WHERE cancelled_at IS NULL), 0) AS total_net,
           COALESCE(SUM(amount_gross)    FILTER (WHERE cancelled_at IS NULL), 0) AS total_gross,
           COALESCE(SUM(amount_discount) FILTER (WHERE cancelled_at IS NULL), 0) AS total_discount,
           COALESCE(AVG(amount_net)      FILTER (WHERE cancelled_at IS NULL), 0) AS avg_ticket,
           COALESCE(
             AVG(EXTRACT(EPOCH FROM (settled_at - intake_at)) / 86400.0)
             FILTER (WHERE intake_at IS NOT NULL AND cancelled_at IS NULL),
           0) AS avg_liquidation_days
         FROM financial_settlements
         WHERE clinic_id = $1`,
        [clinicId],
      ),
      // Monthly net revenue (for chart)
      pool.query(
        `SELECT
           TO_CHAR(DATE_TRUNC('month', settled_at), 'Mon YY') AS month,
           COALESCE(SUM(amount_net) FILTER (WHERE cancelled_at IS NULL), 0) AS net
         FROM financial_settlements
         WHERE clinic_id = $1
         GROUP BY DATE_TRUNC('month', settled_at)
         ORDER BY DATE_TRUNC('month', settled_at)`,
        [clinicId],
      ),
      // Template mix (for bar chart + table)
      pool.query(
        `SELECT
           COALESCE(template_name, 'Sin plantilla') AS name,
           COUNT(*)                                  AS count,
           COALESCE(SUM(amount_net), 0)              AS net
         FROM financial_settlements
         WHERE clinic_id = $1 AND cancelled_at IS NULL
         GROUP BY template_name
         ORDER BY net DESC
         LIMIT 20`,
        [clinicId],
      ),
    ]);

    const s = summaryRes.rows[0] || {};
    const totalNet = parseFloat(s.total_net || 0);
    const totalGross = parseFloat(s.total_gross || 0);
    const totalDiscount = parseFloat(s.total_discount || 0);
    const settledCount = parseInt(s.settled_count || 0, 10);

    // Calculate template pct
    const templateMix = templateRes.rows.map((t) => ({
      name: t.name,
      count: parseInt(t.count, 10),
      net: parseFloat(t.net),
      pct: totalNet > 0 ? parseFloat(((parseFloat(t.net) / totalNet) * 100).toFixed(1)) : 0,
    }));

    res.json({
      summary: {
        totalNet,
        totalGross,
        totalDiscount,
        avgTicket: parseFloat(s.avg_ticket || 0),
        settledCount,
        cancelledCount: parseInt(s.cancelled_count || 0, 10),
        discountRate: totalGross > 0 ? parseFloat(((totalDiscount / totalGross) * 100).toFixed(1)) : 0,
        avgLiquidationDays: parseFloat(parseFloat(s.avg_liquidation_days || 0).toFixed(1)),
      },
      monthly: monthlyRes.rows.map((r) => ({
        month: r.month,
        net: parseFloat(r.net),
      })),
      templateMix,
    });
  } catch (err) {
    logger.error('financials summary error', { userId: req.user.id, error: err.message });
    next(err);
  }
});

// ─── GET /api/financials/settlements ─────────────────────────────────────────

router.get('/settlements', async (req, res, next) => {
  try {
    if (!isAvailable()) return res.json({ settlements: [] });

    const clinicId = await getClinicId(req.user.id);
    if (!clinicId) return res.json({ settlements: [] });

    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const { rows } = await pool.query(
      `SELECT
         fs.id,
         p.name        AS patient_name,
         p.dni         AS patient_dni,
         fs.template_name,
         fs.template_id,
         fs.amount_gross,
         fs.amount_discount,
         fs.amount_net,
         fs.settled_at,
         fs.intake_at,
         fs.cancelled_at,
         fs.payment_method,
         fs.source_system
       FROM financial_settlements fs
       LEFT JOIN patients p ON p.id = fs.patient_id
       WHERE fs.clinic_id = $1
       ORDER BY fs.settled_at DESC
       LIMIT $2 OFFSET $3`,
      [clinicId, limit, offset],
    );

    res.json({ settlements: rows });
  } catch (err) {
    logger.error('financials settlements error', { userId: req.user.id, error: err.message });
    next(err);
  }
});

// ─── GET /api/financials/patients ─────────────────────────────────────────────

router.get('/patients', async (req, res, next) => {
  try {
    if (!isAvailable()) return res.json({ patients: [] });

    const clinicId = await getClinicId(req.user.id);
    if (!clinicId) return res.json({ patients: [] });

    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const { rows } = await pool.query(
      `SELECT id, name, dni, phone, email, total_ltv, last_visit, created_at
       FROM patients
       WHERE clinic_id = $1
       ORDER BY total_ltv DESC
       LIMIT $2 OFFSET $3`,
      [clinicId, limit, offset],
    );

    res.json({ patients: rows });
  } catch (err) {
    logger.error('financials patients error', { userId: req.user.id, error: err.message });
    next(err);
  }
});

module.exports = router;
