'use strict';

/**
 * /api/traceability — end-to-end lead-to-revenue funnel analytics
 *
 * GET /api/traceability/funnel   — WhatsApp engagement cohorts
 * GET /api/traceability/leads    — per-lead source-to-cash traceability table
 *
 * All queries are scoped to req.user.id (leads) and, where relevant,
 * to the user's clinic_id (Doctoralia join).
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { pool, isAvailable } = require('../db');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

async function getClinicId(userId) {
  if (!isAvailable()) return null;
  try {
    const { rows } = await pool.query('SELECT clinic_id FROM users WHERE id = $1', [userId]);
    return rows[0]?.clinic_id || null;
  } catch (err) {
    logger.warn('traceability: could not resolve clinic_id', { userId, error: err.message });
    return null;
  }
}

// ─── GET /api/traceability/funnel ────────────────────────────────────────────

router.get('/funnel', async (req, res, next) => {
  try {
    if (!isAvailable()) return res.status(503).json({ success: false, message: 'Database not available' });

    const { rows } = await pool.query(
      `SELECT
         CASE
           WHEN first_outbound_at IS NULL                                THEN 'not_contacted'
           WHEN first_inbound_at  IS NULL                                THEN 'contacted_no_reply'
           WHEN appointment_status IS NULL AND stage != 'closed'         THEN 'replied_not_booked'
           WHEN appointment_status IN ('scheduled','confirmed')          THEN 'booked_pending'
           WHEN appointment_status = 'showed' AND verified_revenue > 0  THEN 'attended_closed'
           WHEN appointment_status = 'showed'                            THEN 'attended_not_closed'
           WHEN no_show_flag = TRUE                                       THEN 'no_show'
           WHEN stage = 'closed'                                         THEN 'closed_no_appointment'
           ELSE                                                               'replied_other'
         END                                                              AS cohort,
         COUNT(*)                                                         AS lead_count,
         ROUND(COALESCE(SUM(revenue), 0)::numeric, 2)                   AS estimated_revenue,
         ROUND(COALESCE(SUM(verified_revenue), 0)::numeric, 2)          AS verified_revenue_crm,
         ROUND(AVG(reply_delay_minutes)::numeric, 1)                    AS avg_reply_delay_min
       FROM leads
       WHERE user_id = $1
       GROUP BY 1
       ORDER BY lead_count DESC`,
      [req.user.id],
    );

    res.json({ funnel: rows });
  } catch (err) {
    logger.error('traceability funnel error', { userId: req.user.id, error: err.message });
    next(err);
  }
});

// ─── GET /api/traceability/leads ─────────────────────────────────────────────

router.get('/leads', async (req, res, next) => {
  try {
    if (!isAvailable()) return res.status(503).json({ success: false, message: 'Database not available' });

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const clinicId = await getClinicId(req.user.id);

    // Build query with optional Doctoralia join (only if clinic_id is known)
    const { rows } = await pool.query(
      `SELECT
         l.id             AS lead_id,
         l.name           AS lead_name,
         l.email,
         l.phone,
         l.source,
         l.stage,
         l.campaign_name,
         l.adset_name,
         l.ad_name,
         l.form_name,
         l.created_at     AS lead_created_at,
         l.first_outbound_at,
         l.first_inbound_at,
         l.reply_delay_minutes,
         l.appointment_status,
         l.attended_at,
         l.no_show_flag,
         l.revenue        AS estimated_revenue,
         l.verified_revenue AS crm_verified_revenue,
         l.lost_reason,
         p.id             AS patient_id,
         p.total_ltv      AS patient_ltv,
         fs.id            AS settlement_id,
         fs.template_name AS doctoralia_template,
         fs.amount_net    AS doctoralia_net,
         fs.settled_at    AS settlement_date
       FROM leads l
       LEFT JOIN patients p
         ON p.clinic_id = $2
         AND (
           (p.dni_hash = l.dni_hash AND l.dni_hash IS NOT NULL)
           OR p.id = l.converted_patient_id
         )
       LEFT JOIN LATERAL (
         SELECT id, template_name, amount_net, settled_at
         FROM financial_settlements sf
         WHERE sf.patient_id = p.id AND sf.cancelled_at IS NULL
         ORDER BY sf.settled_at DESC
         LIMIT 1
       ) fs ON TRUE
       WHERE l.user_id = $1
       ORDER BY l.created_at DESC
       LIMIT $3 OFFSET $4`,
      [req.user.id, clinicId, limit, offset],
    );

    res.json({ leads: rows });
  } catch (err) {
    logger.error('traceability leads error', { userId: req.user.id, error: err.message });
    next(err);
  }
});

module.exports = router;
