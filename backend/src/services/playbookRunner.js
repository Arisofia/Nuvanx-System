'use strict';

const { pool, isAvailable } = require('../db');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

const RETRY_DELAYS_MS = [1000, 2000, 4000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function emitEvent(userId, eventType, message, metadata = {}) {
  if (!supabaseAdmin) return;
  try {
    await supabaseAdmin
      .schema('monitoring')
      .from('operational_events')
      .insert({ user_id: userId, event_type: eventType, message, metadata });
  } catch (err) {
    logger.warn('[playbook-runner] event write failed', { eventType, error: err.message });
  }
}

async function runStep({ client, runId, stepName }) {
  await client.query(
    `INSERT INTO public.agent_run_steps (run_id, step_name, status, attempts, started_at, completed_at, output)
     VALUES ($1, $2, 'success', 1, NOW(), NOW(), $3)`,
    [runId, stepName, JSON.stringify({ ok: true })],
  );
}

async function runPlaybook({ userId, playbook, metadata = {}, lockKey }) {
  if (!isAvailable()) {
    throw new Error('Database not available');
  }

  const client = await pool.connect();
  let sideEffectLockId = null;

  try {
    await client.query('BEGIN');

    const lockRes = await client.query(
      `INSERT INTO public.side_effect_locks (lock_key, user_id, playbook_id, metadata)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (lock_key) DO NOTHING
       RETURNING id`,
      [lockKey, userId, playbook.id, JSON.stringify(metadata)],
    );

    if (!lockRes.rows[0]) {
      await client.query('ROLLBACK');
      return { skipped: true, reason: 'duplicate_lock', lockKey };
    }
    sideEffectLockId = lockRes.rows[0].id;

    const execRes = await client.query(
      `INSERT INTO public.playbook_executions (playbook_id, user_id, status, metadata)
       VALUES ($1, $2, 'success', $3)
       RETURNING id, created_at`,
      [playbook.id, userId, JSON.stringify({ ...metadata, durable: true, lockKey })],
    );
    const execution = execRes.rows[0];

    const runRes = await client.query(
      `INSERT INTO public.agent_runs (execution_id, user_id, playbook_id, status, metadata)
       VALUES ($1, $2, $3, 'running', $4)
       RETURNING id`,
      [execution.id, userId, playbook.id, JSON.stringify({ lockKey })],
    );
    const runId = runRes.rows[0].id;

    const steps = Array.isArray(playbook.steps) ? playbook.steps : [];
    for (const rawStep of steps) {
      const stepName = typeof rawStep === 'string' ? rawStep : 'step';
      let lastErr = null;

      for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          await runStep({ client, runId, stepName });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < RETRY_DELAYS_MS.length - 1) {
            await sleep(RETRY_DELAYS_MS[attempt]);
          }
        }
      }

      if (lastErr) {
        await client.query(
          `INSERT INTO public.agent_run_steps (run_id, step_name, status, attempts, started_at, completed_at, error)
           VALUES ($1, $2, 'failed', $3, NOW(), NOW(), $4)`,
          [runId, stepName, RETRY_DELAYS_MS.length, lastErr.message],
        );

        await client.query(
          'UPDATE public.agent_runs SET status = $2, error = $3, completed_at = NOW() WHERE id = $1',
          [runId, 'failed', lastErr.message],
        );

        await client.query(
          "UPDATE public.playbook_executions SET status = 'failed' WHERE id = $1",
          [execution.id],
        );

        await client.query('COMMIT');
        await emitEvent(userId, 'playbook_dead_letter', `Playbook ${playbook.slug} failed`, {
          runId,
          executionId: execution.id,
          stepName,
          error: lastErr.message,
        });

        return {
          success: false,
          execution: { id: execution.id, status: 'failed', ranAt: execution.created_at },
          runId,
          sideEffectLockId,
        };
      }
    }

    await client.query(
      'UPDATE public.agent_runs SET status = $2, completed_at = NOW() WHERE id = $1',
      [runId, 'success'],
    );

    await client.query('COMMIT');
    await emitEvent(userId, 'playbook_run', `Playbook ${playbook.slug} executed`, {
      executionId: execution.id,
      runId,
      lockKey,
    });

    return {
      success: true,
      execution: { id: execution.id, status: 'success', ranAt: execution.created_at },
      runId,
      sideEffectLockId,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[playbook-runner] run failed', { error: err.message, userId, playbookId: playbook.id });
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { runPlaybook };