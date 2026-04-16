'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { supabaseFigmaAdmin, supabaseAdmin } = require('../config/supabase');
const { syncUserDataToFigma } = require('../services/figmaSync');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

/**
 * POST /api/figma/sync
 * Sends real user data from Supabase-backed backend models into the
 * Figma project monitoring tables.
 */
router.post('/sync', async (req, res, next) => {
  try {
    const result = await syncUserDataToFigma(req.user.id);
    logger.info('Figma data sync completed', {
      userId: req.user.id,
      commandId: result.command.id,
    });

    res.json({
      success: true,
      message: 'Real data synced to Figma project',
      syncLogId: result.command.id,
      syncedAt: result.command.created_at,
      metrics: result.metrics,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/figma/sync/latest
 * Returns the most recent sync log entry written to the Figma project.
 */
router.get('/sync/latest', async (req, res, next) => {
  try {
    if (!supabaseFigmaAdmin) {
      return res.status(503).json({
        success: false,
        message: 'Supabase Figma client not configured',
      });
    }

    // figmaSync.js writes log rows to figma_sync_log in the Figma project
    const { data, error } = await supabaseFigmaAdmin
      .from('figma_sync_log')
      .select('id, status, message, components_synced, tokens_synced, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return next(error);
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'No sync record found. Run POST /api/figma/sync first.',
      });
    }

    res.json({ success: true, sync: data });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/figma/events
 * Returns the most recent operational events for the authenticated user.
 * Reads from monitoring.operational_events in the main nuvanx-prod project.
 * Used by the LiveDashboard activity feed.
 *
 * Query params:
 *   limit  — max events to return (default 50, max 200)
 */
router.get('/events', async (req, res, next) => {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({
        success: false,
        message: 'Supabase main client not configured',
        events: [],
      });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

    const { data, error } = await supabaseAdmin
      .schema('monitoring')
      .from('operational_events')
      .select('id, event_type, message, metadata, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.warn('figma/events: monitoring query error', { error: error.message });
      return res.json({ success: true, events: [] });
    }

    res.json({
      success: true,
      events: (data || []).map((e) => ({
        id: e.id,
        type: e.event_type,
        message: e.message,
        metadata: e.metadata || {},
        createdAt: e.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});



module.exports = router;
