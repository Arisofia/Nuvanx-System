'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const leadModel = require('../models/lead');
const integrationModel = require('../models/integration');
const credentialModel = require('../models/credential');
const metaService = require('../services/meta');
const hubspotService = require('../services/hubspot');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

/** GET /api/dashboard/metrics */
router.get('/metrics', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [leads, integrations] = await Promise.all([
      leadModel.findByUser(userId),
      integrationModel.getAll(userId),
    ]);

    const totalLeads = leads.length;
    const totalRevenue = leads.reduce((sum, l) => sum + (l.revenue || 0), 0);
    const conversions = leads.filter((l) => l.stage === 'treatment' || l.stage === 'closed').length;
    const conversionRate = totalLeads > 0 ? ((conversions / totalLeads) * 100).toFixed(1) : '0.0';

    const byStage = leadModel.STAGES.reduce((acc, stage) => {
      acc[stage] = leads.filter((l) => l.stage === stage).length;
      return acc;
    }, {});

    const bySource = leads.reduce((acc, l) => {
      acc[l.source] = (acc[l.source] || 0) + 1;
      return acc;
    }, {});

    const connectedIntegrations = integrations.filter((i) => i.status === 'connected').length;

    res.json({
      success: true,
      metrics: {
        totalLeads,
        totalRevenue: parseFloat(totalRevenue.toFixed(2)),
        conversions,
        conversionRate: parseFloat(conversionRate),
        byStage,
        bySource,
        connectedIntegrations,
        totalIntegrations: integrations.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/dashboard/funnel */
router.get('/funnel', async (req, res, next) => {
  try {
    const leads = await leadModel.findByUser(req.user.id);

    const stages = [
      { key: 'lead', label: 'Lead' },
      { key: 'whatsapp', label: 'WhatsApp' },
      { key: 'appointment', label: 'Cita' },
      { key: 'treatment', label: 'Tratamiento' },
      { key: 'closed', label: 'Cerrado' },
    ];

    const total = leads.length || 1;
    const funnel = stages.map((stage) => {
      const count = leads.filter((l) => l.stage === stage.key).length;
      const revenue = leads
        .filter((l) => l.stage === stage.key)
        .reduce((sum, l) => sum + (l.revenue || 0), 0);
      return {
        stage: stage.key,
        label: stage.label,
        count,
        percentage: parseFloat(((count / total) * 100).toFixed(1)),
        revenue: parseFloat(revenue.toFixed(2)),
      };
    });

    res.json({ success: true, funnel });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/dashboard/lead-flow
 * Returns a 24-slot hourly series of leads created today (server-side).
 */
router.get('/lead-flow', async (req, res, next) => {
  try {
    const leads = await leadModel.findByUser(req.user.id);

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // Build 24-slot array covering the last 24 hours
    const slots = Array.from({ length: 24 }, (_, i) => {
      const h = new Date(now);
      h.setHours(now.getHours() - (23 - i), 0, 0, 0);
      return {
        time: h.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        hour: h.getHours(),
        leads: 0,
      };
    });

    for (const lead of leads) {
      const created = lead.createdAt || lead.created_at || '';
      if (!created || !created.startsWith(todayStr)) continue;
      const h = new Date(created).getHours();
      const slot = slots.find((s) => s.hour === h);
      if (slot) slot.leads += 1;
    }

    res.json({ success: true, chart: slots });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/dashboard/revenue-trend
 * Returns historical revenue data grouped by time period for charting.
 */
router.get('/revenue-trend', async (req, res, next) => {
  try {
    const leads = await leadModel.findByUser(req.user.id);

    // Group leads by creation date (or updated date for revenue tracking)
    const revenueByDate = {};
    leads.forEach(lead => {
      if (!lead.revenue || lead.revenue <= 0) return;
      const date = lead.updatedAt?.split('T')[0] || lead.createdAt?.split('T')[0];
      if (!date) return;
      if (!revenueByDate[date]) {
        revenueByDate[date] = { date, revenue: 0, leads: 0 };
      }
      revenueByDate[date].revenue += lead.revenue;
      revenueByDate[date].leads++;
    });

    const trend = Object.values(revenueByDate)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(item => ({
        month: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        revenue: parseFloat(item.revenue.toFixed(2)),
        leads: item.leads,
      }));

    res.json({ success: true, trend });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/dashboard/meta-trends
 * Fetch Meta Marketing API metrics with WoW and MoM calculations.
 * Requires connected Meta integration.
 */
router.get('/meta-trends', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { since, until, adAccountId } = req.query;

    // Get Meta credentials
    const metaToken = await credentialModel.getDecryptedKey(userId, 'meta');
    if (!metaToken) {
      return res.status(404).json({
        success: false,
        message: 'Meta integration not connected. Please connect Meta in Settings.',
      });
    }

    if (!adAccountId) {
      return res.status(400).json({
        success: false,
        message: 'adAccountId query parameter is required (e.g., act_123456789)',
      });
    }

    // Fetch comprehensive metrics with daily breakdown
    const trends = await metaService.getTrendsData(metaToken, adAccountId, { since, until });

    // Calculate WoW and MoM trends
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const twoMonthsAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const filterByDateRange = (data, start, end) =>
      data.filter(d => {
        const date = new Date(d.date_start);
        return date >= start && date < end;
      });

    const sumMetrics = (data) => {
      return data.reduce(
        (acc, item) => ({
          impressions: acc.impressions + parseFloat(item.impressions || 0),
          reach: acc.reach + parseFloat(item.reach || 0),
          clicks: acc.clicks + parseFloat(item.clicks || 0),
          spend: acc.spend + parseFloat(item.spend || 0),
          conversions: acc.conversions + parseFloat(item.conversions || 0),
        }),
        { impressions: 0, reach: 0, clicks: 0, spend: 0, conversions: 0 },
      );
    };

    const thisWeek = sumMetrics(filterByDateRange(trends, oneWeekAgo, now));
    const lastWeek = sumMetrics(filterByDateRange(trends, twoWeeksAgo, oneWeekAgo));
    const thisMonth = sumMetrics(filterByDateRange(trends, oneMonthAgo, now));
    const lastMonth = sumMetrics(filterByDateRange(trends, twoMonthsAgo, oneMonthAgo));

    const calculateChange = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return parseFloat((((current - previous) / previous) * 100).toFixed(1));
    };

    const wow = {
      impressions: calculateChange(thisWeek.impressions, lastWeek.impressions),
      reach: calculateChange(thisWeek.reach, lastWeek.reach),
      clicks: calculateChange(thisWeek.clicks, lastWeek.clicks),
      spend: calculateChange(thisWeek.spend, lastWeek.spend),
      conversions: calculateChange(thisWeek.conversions, lastWeek.conversions),
    };

    const mom = {
      impressions: calculateChange(thisMonth.impressions, lastMonth.impressions),
      reach: calculateChange(thisMonth.reach, lastMonth.reach),
      clicks: calculateChange(thisMonth.clicks, lastMonth.clicks),
      spend: calculateChange(thisMonth.spend, lastMonth.spend),
      conversions: calculateChange(thisMonth.conversions, lastMonth.conversions),
    };

    res.json({
      success: true,
      trends: trends.map(t => ({
        date: t.date_start,
        impressions: parseFloat(t.impressions || 0),
        reach: parseFloat(t.reach || 0),
        clicks: parseFloat(t.clicks || 0),
        spend: parseFloat(t.spend || 0),
        ctr: parseFloat(t.ctr || 0),
        cpc: parseFloat(t.cpc || 0),
        cpm: parseFloat(t.cpm || 0),
        conversions: parseFloat(t.conversions || 0),
      })),
      wow,
      mom,
      summary: {
        thisWeek,
        lastWeek,
        thisMonth,
        lastMonth,
      },
    });
  } catch (err) {
    logger.error('Meta trends error', { error: err.message });
    next(err);
  }
});

/**
 * GET /api/dashboard/hubspot-trends
 * Fetch HubSpot CRM trends data.
 * Requires connected HubSpot integration.
 */
router.get('/hubspot-trends', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { since, until } = req.query;

    // Get HubSpot credentials
    const hubspotToken = await credentialModel.getDecryptedKey(userId, 'hubspot');
    if (!hubspotToken) {
      return res.status(404).json({
        success: false,
        message: 'HubSpot integration not connected. Please connect HubSpot in Settings.',
      });
    }

    const data = await hubspotService.getTrends(hubspotToken, { since, until });

    res.json({
      success: true,
      ...data,
    });
  } catch (err) {
    logger.error('HubSpot trends error', { error: err.message });
    next(err);
  }
});

module.exports = router;
