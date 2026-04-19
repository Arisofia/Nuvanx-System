'use strict';

/**
 * Durable playbook execution runtime.
 *
 * Replaces the fire-and-forget pattern in playbookAutomation.js with a
 * DB-backed execution log that provides:
 *
 *   - Per-step audit trail  (public.agent_run_steps)
 *   - Idempotency locks     (public.side_effect_locks)
 *   - Automatic retry       (exponential backoff, up to MAX_ATTEMPTS)
 *   - Dead-letter emission  (monitoring.operational_events after exhausted retries)
 *
 * Usage:
 *
 *   const playbookRunner = require('./playbookRunner');
 *
 *   playbookRunner.run({
 *     playbookSlug: 'lead-capture-nurture',
 *     userId,
 *     context: { leadId, idempotencyKey: `lead_capture_nurture:${leadId}` },
 *     steps: [
 *       { name: 'whatsapp_welcome', fn: async () => { ... return outputObject; } },
 *     ],
 *   }).catch(err => logger.error('[runner] top-level error', { error: err.message }));
 */

const { pool, isAvailable } = require('../db');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 1000;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Insert a playbook_executions row with status='running'.
 * Returns the new UUID, or null on error.
 */
async function _createRun(playbookId, userId, context, attempt, idempotencyKey) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.playbook_executions
         (playbook_id, user_id, status, metadata, started_at, attempt, idempotency_key)
       VALUES ($1, $2, 'running', $3, NOW(), $4, $5)
       RETURNING id`,
      [playbookId, userId, JSON.stringify(context), attempt, idempotencyKey || null],
    );
    return rows[0]?.id || null;
  } catch (err) {
    logger.warn('[runner] _createRun error', { error: err.message });
    return null;
  }
}

/**
 * Attempt to acquire a side-effect lock for the given idempotency key.
 * Returns true if the lock was acquired, false if already held (duplicate run).
 * On DB error, returns true so the run proceeds (best-effort idempotency).
 */
async function _acquireLock(idempotencyKey, runId) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.side_effect_locks (idempotency_key, run_id)
       VALUES ($1, $2)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING idempotency_key`,
      [idempotencyKey, runId],
    );
    return rows.length > 0;
  } catch (err) {
    logger.warn('[runner] _acquireLock error — allowing run to proceed', {
      idempotencyKey,
      error: err.message,
    });
    return true;
  }
}

/**
 * Release an idempotency lock so a retry can acquire it.
 */
async function _releaseLock(idempotencyKey) {
  try {
    await pool.query(
      `DELETE FROM public.side_effect_locks WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
  } catch (err) {
    logger.warn('[runner] _releaseLock error', { idempotencyKey, error: err.message });
  }
}

/**
 * Set final status + finished_at on a playbook_executions row.
 */
async function _finalizeRun(runId, status, errorMessage) {
  try {
    await pool.query(
      `UPDATE public.playbook_executions
         SET status=$1, finished_at=NOW(), error_message=$2
       WHERE id=$3`,
      [status, errorMessage || null, runId],
    );
  } catch (err) {
    logger.warn('[runner] _finalizeRun error', { runId, error: err.message });
  }
}

/**
 * Insert an agent_run_steps row, invoke stepFn(), and update the row.
 * Never throws — errors are captured and returned in the result object.
 *
 * @returns {{ success: boolean, output: object, error: string|null }}
 */
async function _executeStep(runId, stepIndex, stepName, stepFn) {
  let stepRowId = null;

  try {
    const { rows } = await pool.query(
      `INSERT INTO public.agent_run_steps (run_id, step_index, step_name, status, started_at)
       VALUES ($1, $2, $3, 'running', NOW())
       RETURNING id`,
      [runId, stepIndex, stepName || `step_${stepIndex}`],
    );
    stepRowId = rows[0]?.id || null;
  } catch (dbErr) {
    logger.warn('[runner] could not insert step row', {
      runId,
      stepIndex,
      error: dbErr.message,
    });
  }

  let output = {};
  let stepError = null;

  try {
    const result = await stepFn();
    output = result && typeof result === 'object' ? result : {};
  } catch (err) {
    stepError = err.message || String(err);
    logger.warn('[runner] step failed', { runId, stepIndex, stepName, error: stepError });
  }

  if (stepRowId) {
    try {
      await pool.query(
        `UPDATE public.agent_run_steps
           SET status=$1, finished_at=NOW(), output=$2, error=$3
         WHERE id=$4`,
        [stepError ? 'failed' : 'success', JSON.stringify(output), stepError || null, stepRowId],
      );
    } catch (dbErr) {
      logger.warn('[runner] could not update step row', { stepRowId, error: dbErr.message });
    }
  }

  return { success: !stepError, output, error: stepError };
}

/**
 * Emit a permanent-failure event to monitoring.operational_events.
 */
async function _emitDeadLetter(runId, playbookSlug, userId, errorMessage) {
  if (!supabaseAdmin) return;
  try {
    await supabaseAdmin
      .schema('monitoring')
      .from('operational_events')
      .insert({
        user_id: userId || null,
        event_type: 'playbook_dead_letter',
        message: `Playbook "${playbookSlug}" permanently failed after ${MAX_ATTEMPTS} attempts`,
        metadata: { run_id: runId, error: errorMessage },
      });
  } catch (err) {
    logger.warn('[runner] dead-letter emission failed', { runId, error: err.message });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Execute a playbook with durable semantics.
 *
 * Idempotency: if context.idempotencyKey is set, the runner acquires a DB lock
 * before executing steps.  Duplicate calls with the same key are silently
 * skipped.
 *
 * Retries: on step failure the run is marked 'failed' and re-scheduled via
 * setTimeout with exponential backoff.  After MAX_ATTEMPTS the run is
 * permanently failed and a dead-letter event is emitted.
 *
 * @param {object}   opts
 * @param {string}   opts.playbookSlug  Slug of an existing public.playbooks row.
 * @param {string}   opts.userId        UUID of the acting user.
 * @param {object}   [opts.context={}]  Stored in metadata; set idempotencyKey for dedup.
 * @param {Array<{name: string, fn: Function}>} opts.steps  Ordered step array.
 * @param {number}   [opts.attempt=1]   Internal — incremented on retry.
 */
async function run({ playbookSlug, userId, context = {}, steps, attempt = 1 }) {
  if (!isAvailable()) {
    logger.warn('[runner] DB unavailable — skipping durable run', { playbookSlug, userId });
    return;
  }

  // Resolve the playbook definition
  let playbookRow;
  try {
    const { rows } = await pool.query(
      `SELECT id, title, status FROM public.playbooks WHERE slug = $1`,
      [playbookSlug],
    );
    playbookRow = rows[0];
  } catch (err) {
    logger.warn('[runner] could not resolve playbook', { playbookSlug, error: err.message });
    return;
  }

  if (!playbookRow) {
    logger.warn('[runner] playbook not found', { playbookSlug });
    return;
  }

  if (playbookRow.status === 'archived') {
    logger.warn('[runner] playbook is archived — skipping', { playbookSlug });
    return;
  }

  const idempotencyKey = context.idempotencyKey || null;

  // Create the execution row
  const runId = await _createRun(playbookRow.id, userId, context, attempt, idempotencyKey);
  if (!runId) {
    logger.warn('[runner] could not create execution row — aborting', { playbookSlug });
    return;
  }

  // Acquire idempotency lock if a key was provided
  if (idempotencyKey) {
    const locked = await _acquireLock(idempotencyKey, runId);
    if (!locked) {
      await pool.query(
        `UPDATE public.playbook_executions SET status='skipped', finished_at=NOW() WHERE id=$1`,
        [runId],
      ).catch((err) => logger.warn('[runner] could not mark run skipped', { runId, error: err.message }));
      logger.info('[runner] run skipped — duplicate idempotency key', {
        playbookSlug,
        idempotencyKey,
      });
      return;
    }
  }

  logger.info('[runner] run started', { playbookSlug, runId, attempt });

  // Execute steps in order; stop on first failure
  let failedStep = null;
  for (let i = 0; i < steps.length; i++) {
    const { name, fn } = steps[i];
    const result = await _executeStep(runId, i, name, fn);
    if (!result.success) {
      failedStep = { index: i, name, error: result.error };
      break;
    }
  }

  if (failedStep) {
    await _finalizeRun(runId, 'failed', failedStep.error);

    if (attempt < MAX_ATTEMPTS) {
      const delayMs = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      logger.info('[runner] scheduling retry', {
        playbookSlug,
        attempt,
        nextAttempt: attempt + 1,
        delayMs,
      });

      // Release the lock so the next attempt can acquire it
      if (idempotencyKey) {
        await _releaseLock(idempotencyKey);
      }

      setTimeout(() => {
        run({ playbookSlug, userId, context, steps, attempt: attempt + 1 }).catch((err) => {
          logger.error('[runner] retry threw', {
            playbookSlug,
            attempt: attempt + 1,
            error: err.message,
          });
        });
      }, delayMs);
    } else {
      logger.error('[runner] run permanently failed', {
        playbookSlug,
        runId,
        error: failedStep.error,
      });
      await _emitDeadLetter(runId, playbookSlug, userId, failedStep.error);
    }
  } else {
    await _finalizeRun(runId, 'success');
    logger.info('[runner] run completed successfully', { playbookSlug, runId });
  }
}

module.exports = { run };
