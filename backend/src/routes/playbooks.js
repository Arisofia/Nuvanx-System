'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { pool, isAvailable } = require('../db');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

async function persistAgentOutput(userId, agentType, output, metadata = {}) {
  if (!supabaseAdmin) {
    logger.warn('Supabase admin client unavailable for playbook agent output persistence', { userId, agentType });
    return null;
  }

  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('clinic_id')
    .eq('id', userId)
    .single();

  if (userError) {
    logger.warn('Unable to resolve clinic_id for playbook agent output persistence', { userId, error: userError.message });
  }

  const record = {
    user_id: userId,
    clinic_id: user?.clinic_id || null,
    agent_type: agentType,
    output,
    metadata,
  };

  const { data, error } = await supabaseAdmin
    .from('agent_outputs')
    .insert(record)
    .select('id')
    .single();

  if (error) {
    logger.warn('Failed to persist playbook agent output', { userId, agentType, error: error.message });
    return null;
  }

  return data?.id ?? null;
}

/**
 * GET /api/playbooks
 * Returns all playbooks merged with real execution stats for the requesting user.
 */
router.get('/', async (req, res, next) => {
  try {
    if (!isAvailable()) {
      return res.status(503).json({ success: false, message: 'Database not available' });
    }

    const userId = req.user.id;

    // Playbook definitions with per-user run stats in a single query
    const { rows } = await pool.query(
      `SELECT
         p.id,
         p.slug,
         p.title,
         p.description,
         p.category,
         p.status,
         p.steps,
         p.created_at,
         COUNT(pe.id)                                          AS runs,
         COUNT(pe.id) FILTER (WHERE pe.status = 'success')    AS successful_runs,
         MAX(pe.created_at)                                    AS last_run_at
       FROM public.playbooks p
       LEFT JOIN public.playbook_executions pe
              ON pe.playbook_id = p.id AND pe.user_id = $1
       WHERE p.status != 'archived'
       GROUP BY p.id
       ORDER BY p.category, p.title`,
      [userId],
    );

    const playbooks = rows.map((row) => {
      const runs = parseInt(row.runs, 10);
      const successful = parseInt(row.successful_runs, 10);
      return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        category: row.category,
        status: row.status,
        steps: row.steps || [],
        runs,
        successRate: runs > 0 ? parseFloat(((successful / runs) * 100).toFixed(1)) : null,
        lastRunAt: row.last_run_at || null,
      };
    });

    res.json({ success: true, playbooks });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/playbooks/:slug/run
 * Records a playbook execution. Writes a row to playbook_executions and
 * emits an operational event to the monitoring schema.
 *
 * Body (all optional):
 *   { metadata: object }   — contextual data to store with the execution
 */
router.post('/:slug/run', async (req, res, next) => {
  try {
    if (!isAvailable()) {
      return res.status(503).json({ success: false, message: 'Database not available' });
    }

    const { slug } = req.params;
    const userId = req.user.id;
    const metadata = req.body?.metadata || {};

    // Resolve the playbook
    const { rows: pbRows } = await pool.query(
      'SELECT id, title, status FROM public.playbooks WHERE slug = $1',
      [slug],
    );

    if (pbRows.length === 0) {
      return res.status(404).json({ success: false, message: `Playbook '${slug}' not found` });
    }

    const playbook = pbRows[0];

    if (playbook.status === 'archived') {
      return res.status(400).json({ success: false, message: 'Playbook is archived and cannot be run' });
    }

    // Insert execution record
    const agentOutputId = await persistAgentOutput(req.user.id, 'playbook.run', {
      playbookSlug: slug,
      playbookTitle: playbook.title,
      status: 'success',
      metadata,
    }, {
      source: 'backend.playbooks.run',
    });

    const executionMetadata = {
      ...metadata,
      ...(agentOutputId ? { agent_output_id: agentOutputId } : {}),
    };

    const { rows: execRows } = await pool.query(
      `INSERT INTO public.playbook_executions (playbook_id, user_id, status, metadata, agent_output_id)
       VALUES ($1, $2, 'success', $3, $4)
       RETURNING id, status, created_at`,
      [playbook.id, userId, JSON.stringify(executionMetadata), agentOutputId],
    );

    const execution = execRows[0];

    // Emit operational event (best-effort)
    if (supabaseAdmin) {
      supabaseAdmin
        .schema('monitoring')
        .from('operational_events')
        .insert({
          user_id: userId,
          event_type: 'playbook_run',
          message: `Playbook "${playbook.title}" executed`,
          metadata: { playbook_slug: slug, execution_id: execution.id },
        })
        .then(() => {})
        .catch((e) => logger.warn('playbook/run: event emission failed', { error: e.message }));
    }

    logger.info('Playbook executed', { userId, slug, executionId: execution.id });

    res.json({
      success: true,
      execution: {
        id: execution.id,
        playbookSlug: slug,
        playbookTitle: playbook.title,
        status: execution.status,
        ranAt: execution.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
