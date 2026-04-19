'use strict';

/**
 * /api/meta — Meta (Facebook/Instagram) Ads Intelligence
 *
 * GET /api/meta/insights?days=30   — account-level KPIs + daily time series
 * GET /api/meta/campaigns?days=30  — campaigns with per-campaign insights
 *
 * Credential resolution order (same as integrations.js):
 *   1. Per-user encrypted vault  (credentials table)
 *   2. Server-level env var      (config.metaAccessToken) when allowSharedCredentials=true
 *
 * adAccountId resolution order:
 *   1. integrations.metadata.adAccountId  (saved via PATCH /api/integrations/meta)
 *   2. config.metaAdAccountId              (META_AD_ACCOUNT_ID env var)
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const metaService = require('../services/meta');
const {
  resolveMetaCredential: resolveMetaCredentialPayload,
  resolveMetaAdAccountId,
} = require('../services/metaCredential');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

// ─── helpers ─────────────────────────────────────────────────────────────────

async function resolveMetaCredential(userId) {
  const resolved = await resolveMetaCredentialPayload(userId);
  return resolved.token;
}

async function resolveAdAccountId(userId) {
  return resolveMetaAdAccountId(userId);
}

function parseDays(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 30;
  return Math.min(n, 365);
}

function sumPeriod(rows) {
  return rows.reduce(
    (a, d) => ({
      spend: a.spend + parseFloat(d.spend || 0),
      impressions: a.impressions + parseFloat(d.impressions || 0),
      reach: a.reach + parseFloat(d.reach || 0),
      clicks: a.clicks + parseFloat(d.clicks || 0),
      conversions: a.conversions + parseFloat(d.conversions || 0),
    }),
    { spend: 0, impressions: 0, reach: 0, clicks: 0, conversions: 0 },
  );
}

function changePct(cur, prev) {
  if (prev === 0) return cur > 0 ? 100 : 0;
  return parseFloat((((cur - prev) / prev) * 100).toFixed(1));
}

// ─── GET /api/meta/insights ───────────────────────────────────────────────────

router.get('/insights', async (req, res, next) => {
  try {
    const days = parseDays(req.query.days);

    const token = await resolveMetaCredential(req.user.id);
    if (!token) {
      return res.json({ success: false, notConnected: true });
    }

    const adAccountId = await resolveAdAccountId(req.user.id);
    if (!adAccountId) {
      return res.json({ success: false, noAccountId: true });
    }

    const until = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const daily = await metaService.getTrendsData(token, adAccountId, { since, until });

    // Account-level summary
    const raw = sumPeriod(daily);
    const summary = {
      spend: parseFloat(raw.spend.toFixed(2)),
      impressions: Math.round(raw.impressions),
      reach: Math.round(raw.reach),
      clicks: Math.round(raw.clicks),
      conversions: Math.round(raw.conversions),
      ctr: raw.impressions > 0 ? parseFloat(((raw.clicks / raw.impressions) * 100).toFixed(2)) : 0,
      cpc: raw.clicks > 0 ? parseFloat((raw.spend / raw.clicks).toFixed(2)) : 0,
      cpm: raw.impressions > 0 ? parseFloat(((raw.spend / raw.impressions) * 1000).toFixed(2)) : 0,
    };

    // WoW change percentages (last 7 days vs 7 days before that)
    const now = Date.now();
    const thisWeekStart = new Date(now - 7 * 86400000);
    const lastWeekStart = new Date(now - 14 * 86400000);
    const tw = sumPeriod(daily.filter((d) => new Date(d.date_start) >= thisWeekStart));
    const lw = sumPeriod(
      daily.filter((d) => {
        const dt = new Date(d.date_start);
        return dt >= lastWeekStart && dt < thisWeekStart;
      }),
    );
    const changes = {
      spend: changePct(tw.spend, lw.spend),
      impressions: changePct(tw.impressions, lw.impressions),
      reach: changePct(tw.reach, lw.reach),
      clicks: changePct(tw.clicks, lw.clicks),
      conversions: changePct(tw.conversions, lw.conversions),
    };

    const dailyNormalized = daily.map((d) => ({
      date: d.date_start,
      spend: parseFloat(d.spend || 0),
      impressions: Math.round(parseFloat(d.impressions || 0)),
      reach: Math.round(parseFloat(d.reach || 0)),
      clicks: Math.round(parseFloat(d.clicks || 0)),
      ctr: parseFloat(d.ctr || 0),
      cpc: parseFloat(d.cpc || 0),
      cpm: parseFloat(d.cpm || 0),
      conversions: parseFloat(d.conversions || 0),
    }));

    res.json({
      success: true,
      period: { since, until, days },
      summary,
      daily: dailyNormalized,
      changes,
    });
  } catch (err) {
    logger.error('Meta insights error', { userId: req.user.id, error: err.message });
    next(err);
  }
});

// ─── GET /api/meta/campaigns ──────────────────────────────────────────────────

router.get('/campaigns', async (req, res, next) => {
  try {
    const days = parseDays(req.query.days);

    const token = await resolveMetaCredential(req.user.id);
    if (!token) {
      return res.json({ success: false, notConnected: true, campaigns: [] });
    }

    const adAccountId = await resolveAdAccountId(req.user.id);
    if (!adAccountId) {
      return res.json({ success: false, noAccountId: true, campaigns: [] });
    }

    const until = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const campaigns = await metaService.getCampaignsWithInsights(token, adAccountId, { since, until });

    res.json({ success: true, campaigns });
  } catch (err) {
    logger.error('Meta campaigns error', { userId: req.user.id, error: err.message });
    next(err);
  }
});

module.exports = router;
