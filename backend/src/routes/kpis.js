'use strict';

/**
 * /api/kpis — aggregated KPI summary for the Revenue Intelligence dashboard
 *
 * GET /api/kpis  — returns:
 *   {
 *     doctoralia: { totalNet, avgTicket, settledCount, cancelledCount, discountRate, avgLiquidationDays },
 *     acquisition: { totalLeads, contacted, replied, replyRate },
 *     blocked: [{ kpi_name, kpi_group, blocked_reason, required_field }]
 *   }
 *
 * Doctoralia KPIs are scoped to clinic_id; acquisition KPIs to user_id.
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
    logger.warn('kpis: could not resolve clinic_id', { userId, error: err.message });
    return null;
  }
}

router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.id;

    if (!isAvailable()) {
      return res.status(503).json({ success: false, message: 'Database not available' });
    }

    const clinicId = await getClinicId(userId);

    const [docRes, acqRes, blockedRes] = await Promise.all([
      // Doctoralia KPIs (clinic-scoped)
      clinicId
        ? pool.query(
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
             FROM financial_settlements WHERE clinic_id = $1`,
            [clinicId],
          )
        : Promise.resolve({ rows: [{}] }),

      // Acquisition KPIs (user-scoped leads)
      pool.query(
        `SELECT
           COUNT(*)                                                    AS total_leads,
           COUNT(*) FILTER (WHERE first_outbound_at IS NOT NULL)       AS contacted,
           COUNT(*) FILTER (WHERE first_inbound_at  IS NOT NULL)       AS replied
         FROM leads WHERE user_id = $1`,
        [userId],
      ),

      // Blocked KPI catalogue (global — not user-scoped)
      pool.query(
        `SELECT kpi_name, kpi_group, blocked_reason, required_field
         FROM kpi_blocked ORDER BY kpi_group, kpi_name`
      ).catch(() => ({ rows: [] })),
    ]);

    const d = docRes.rows[0] || {};
    const a = acqRes.rows[0] || {};

    const totalNet = parseFloat(d.total_net || 0);
    const totalGross = parseFloat(d.total_gross || 0);
    const totalDiscount = parseFloat(d.total_discount || 0);
    const contacted = parseInt(a.contacted || 0, 10);
    const replied = parseInt(a.replied || 0, 10);

    res.json({
      doctoralia: {
        totalNet,
        avgTicket: parseFloat(d.avg_ticket || 0),
        settledCount: parseInt(d.settled_count || 0, 10),
        cancelledCount: parseInt(d.cancelled_count || 0, 10),
        discountRate: totalGross > 0 ? parseFloat(((totalDiscount / totalGross) * 100).toFixed(1)) : 0,
        avgLiquidationDays: parseFloat(parseFloat(d.avg_liquidation_days || 0).toFixed(1)),
      },
      acquisition: {
        totalLeads: parseInt(a.total_leads || 0, 10),
        contacted,
        replied,
        replyRate: contacted > 0 ? parseFloat(((replied / contacted) * 100).toFixed(1)) : null,
      },
      blocked: blockedRes.rows,
    });
  } catch (err) {
    logger.error('kpis error', { userId: req.user.id, error: err.message });
    next(err);
  }
});

module.exports = router;
