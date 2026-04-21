'use strict';

/**
 * /api/reports — aggregated report data for the Revenue Intelligence dashboard
 *
 * GET /api/reports/doctoralia-financials   — byMonth + templateSummary
 * GET /api/reports/campaign-performance    — per-campaign funnel metrics
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
    logger.warn('reports: could not resolve clinic_id', { userId, error: err.message });
    return null;
  }
}

// ─── GET /api/reports/doctoralia-financials ───────────────────────────────────

router.get('/doctoralia-financials', async (req, res, next) => {
  try {
    if (!isAvailable()) return res.json({ byMonth: [], templateSummary: [] });

    const clinicId = await getClinicId(req.user.id);
    if (!clinicId) return res.json({ byMonth: [], templateSummary: [] });

    const [monthlyRes, templateRes] = await Promise.all([
      pool.query(
        `SELECT
           DATE_TRUNC('month', settled_at)                                                AS settled_month,
           COUNT(*) FILTER (WHERE cancelled_at IS NULL)                                   AS operations_count,
           COUNT(*) FILTER (WHERE cancelled_at IS NOT NULL)                               AS cancellation_count,
           ROUND(SUM(amount_gross)    FILTER (WHERE cancelled_at IS NULL)::numeric, 2)    AS total_gross,
           ROUND(SUM(amount_discount) FILTER (WHERE cancelled_at IS NULL)::numeric, 2)    AS total_discount,
           ROUND(SUM(amount_net)      FILTER (WHERE cancelled_at IS NULL)::numeric, 2)    AS total_net,
           ROUND(AVG(amount_net)      FILTER (WHERE cancelled_at IS NULL)::numeric, 2)    AS avg_ticket_net,
           ROUND(
             100.0 * COUNT(*) FILTER (WHERE cancelled_at IS NOT NULL)::numeric /
             NULLIF(COUNT(*), 0), 1
           ) AS cancellation_rate_pct,
           ROUND(
             100.0 * SUM(amount_discount) FILTER (WHERE cancelled_at IS NULL) /
             NULLIF(SUM(amount_gross) FILTER (WHERE cancelled_at IS NULL), 0)::numeric, 1
           ) AS discount_rate_pct,
           ROUND(
             AVG(EXTRACT(EPOCH FROM (settled_at - intake_at)) / 86400.0)
             FILTER (WHERE intake_at IS NOT NULL AND cancelled_at IS NULL)::numeric, 1
           ) AS avg_liquidation_lag_days
         FROM financial_settlements
         WHERE clinic_id = $1
         GROUP BY DATE_TRUNC('month', settled_at)
         ORDER BY settled_month`,
        [clinicId],
      ),
      pool.query(
        `SELECT
           template_id,
           COALESCE(template_name, 'Sin plantilla')                                       AS template_name,
           COUNT(*)                                                                        AS operations_count,
           COUNT(*) FILTER (WHERE cancelled_at IS NOT NULL)                               AS cancellation_count,
           ROUND(SUM(amount_gross)    FILTER (WHERE cancelled_at IS NULL)::numeric, 2)    AS total_gross,
           ROUND(SUM(amount_discount) FILTER (WHERE cancelled_at IS NULL)::numeric, 2)    AS total_discount,
           ROUND(SUM(amount_net)      FILTER (WHERE cancelled_at IS NULL)::numeric, 2)    AS total_net,
           ROUND(AVG(amount_net)      FILTER (WHERE cancelled_at IS NULL)::numeric, 2)    AS avg_ticket_net
         FROM financial_settlements
         WHERE clinic_id = $1
         GROUP BY template_id, template_name
         ORDER BY total_net DESC
         LIMIT 20`,
        [clinicId],
      ),
    ]);

    res.json({
      byMonth: monthlyRes.rows,
      templateSummary: templateRes.rows,
    });
  } catch (err) {
    logger.error('reports doctoralia-financials error', { userId: req.user.id, error: err.message });
    next(err);
  }
});

// ─── GET /api/reports/campaign-performance ────────────────────────────────────

router.get('/campaign-performance', async (req, res, next) => {
  try {
    if (!isAvailable()) return res.json({ campaigns: [] });

    const { rows } = await pool.query(
      `SELECT
         COALESCE(campaign_name, 'Organic / Unknown') AS campaign_name,
         campaign_id,
         COUNT(*)                                                                          AS total_leads,
         COUNT(*) FILTER (WHERE first_outbound_at IS NOT NULL)                            AS contacted,
         COUNT(*) FILTER (WHERE first_inbound_at  IS NOT NULL)                            AS replied,
         COUNT(*) FILTER (WHERE appointment_status IN ('scheduled','confirmed','showed'))  AS booked,
         COUNT(*) FILTER (WHERE appointment_status = 'showed')                            AS attended,
         COUNT(*) FILTER (WHERE no_show_flag = TRUE)                                      AS no_shows,
         COUNT(*) FILTER (WHERE stage = 'closed')                                         AS closed,
         COUNT(*) FILTER (WHERE verified_revenue > 0)                                     AS closed_won,
         ROUND(COALESCE(SUM(revenue), 0)::numeric, 2)           AS estimated_revenue,
         ROUND(COALESCE(SUM(verified_revenue), 0)::numeric, 2)  AS verified_revenue_crm,
         ROUND(
           100.0 * COUNT(*) FILTER (WHERE first_inbound_at IS NOT NULL)::numeric /
           NULLIF(COUNT(*) FILTER (WHERE first_outbound_at IS NOT NULL), 0), 1
         ) AS reply_rate_pct,
         ROUND(
           100.0 * COUNT(*) FILTER (WHERE stage = 'closed')::numeric / NULLIF(COUNT(*), 0), 1
         ) AS lead_to_close_rate_pct,
         ROUND(AVG(reply_delay_minutes)::numeric, 1) AS avg_reply_delay_min
       FROM leads
       WHERE user_id = $1
       GROUP BY campaign_name, campaign_id
       ORDER BY total_leads DESC`,
      [req.user.id],
    );

    res.json({ campaigns: rows });
  } catch (err) {
    logger.error('reports campaign-performance error', { userId: req.user.id, error: err.message });
    next(err);
  }
});

module.exports = router;
