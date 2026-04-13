'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const leadModel = require('../models/lead');
const integrationModel = require('../models/integration');

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

module.exports = router;
