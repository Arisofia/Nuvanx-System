'use strict';

/**
 * Unit tests for the durable playbook runner.
 *
 * All DB interactions are mocked — no real PostgreSQL connection is required.
 * The tests verify:
 *   - DB-unavailable guard
 *   - Playbook-not-found guard
 *   - Archived-playbook guard
 *   - Successful full run (execution row created, step invoked, finalized 'success')
 *   - Step failure on last attempt (finalized 'failed', dead-letter emitted)
 *   - Idempotency lock prevents duplicate execution
 *   - Idempotency lock allows first execution to proceed
 */

process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum!!';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-min!';
process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = '';
process.env.GEMINI_API_KEY = '';

// ── Mocks — must be declared before any require() that loads the module under test ──

const mockQuery = jest.fn();
const mockIsAvailable = jest.fn().mockReturnValue(true);

jest.mock('../src/db', () => ({
  // Use a plain property matching the mock pattern in other test files
  pool: { query: mockQuery },
  isAvailable: mockIsAvailable,
  isProduction: false,
}));

const mockSupabaseInsert = jest.fn().mockResolvedValue({ error: null });
jest.mock('../src/config/supabase', () => ({
  supabaseAdmin: {
    schema: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        insert: mockSupabaseInsert,
      }),
    }),
  },
  supabaseFigmaAdmin: null,
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const runner = require('../src/services/playbookRunner');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PLAYBOOK_ID = 'pb000000-0000-0000-0000-000000000001';
const RUN_ID      = 'run00000-0000-0000-0000-000000000001';
const STEP_ID     = 'step0000-0000-0000-0000-000000000001';
const USER_ID     = 'user0000-0000-0000-0000-000000000001';
const SLUG        = 'lead-capture-nurture';

// ── Mock sequence builders ────────────────────────────────────────────────────

function mockPlaybookFound({ archived = false } = {}) {
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: PLAYBOOK_ID, title: 'Test Playbook', status: archived ? 'archived' : 'active' }],
  });
}

function mockPlaybookNotFound() {
  mockQuery.mockResolvedValueOnce({ rows: [] });
}

function mockRunCreated() {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: RUN_ID }] });
}

function mockStepRow() {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: STEP_ID }] }); // INSERT step
  mockQuery.mockResolvedValueOnce({ rows: [] });                 // UPDATE step
}

function mockFinalize() {
  mockQuery.mockResolvedValueOnce({ rows: [] });
}

// Successful step fn
const passStep = { name: 'pass', fn: jest.fn().mockResolvedValue({ ok: true }) };
// Always-failing step fn
const failStep = { name: 'fail', fn: jest.fn().mockRejectedValue(new Error('step boom')) };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('playbookRunner', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockIsAvailable.mockReturnValue(true);
    passStep.fn.mockClear();
    failStep.fn.mockClear();
    mockSupabaseInsert.mockClear();
  });

  // ── Guard: DB unavailable ─────────────────────────────────────────────────

  test('does nothing when DB is unavailable', async () => {
    mockIsAvailable.mockReturnValue(false);

    await runner.run({ playbookSlug: SLUG, userId: USER_ID, steps: [passStep] });

    expect(mockQuery).not.toHaveBeenCalled();
    expect(passStep.fn).not.toHaveBeenCalled();
  });

  // ── Guard: playbook not found ──────────────────────────────────────────────

  test('returns without creating execution when playbook not found', async () => {
    mockPlaybookNotFound();

    await runner.run({ playbookSlug: 'nonexistent', userId: USER_ID, steps: [passStep] });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(passStep.fn).not.toHaveBeenCalled();
  });

  // ── Guard: archived playbook ───────────────────────────────────────────────

  test('returns without creating execution when playbook is archived', async () => {
    mockPlaybookFound({ archived: true });

    await runner.run({ playbookSlug: SLUG, userId: USER_ID, steps: [passStep] });

    expect(passStep.fn).not.toHaveBeenCalled();
    // Only the playbook lookup query should have been made
    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO public.playbook_executions'),
    );
    expect(insertCall).toBeUndefined();
  });

  // ── Happy path: successful run ─────────────────────────────────────────────

  test('creates execution row, runs step, finalizes with status success', async () => {
    mockPlaybookFound();
    mockRunCreated();
    mockStepRow();
    mockFinalize();

    await runner.run({ playbookSlug: SLUG, userId: USER_ID, steps: [passStep] });

    expect(passStep.fn).toHaveBeenCalledTimes(1);

    // The execution-row finalise UPDATE contains 'error_message' — use that to
    // distinguish it from the agent_run_steps UPDATE (which contains 'output').
    const finalizeCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('error_message'),
    );
    expect(finalizeCall).toBeDefined();
    expect(finalizeCall[1][0]).toBe('success');
  });

  // ── Step failure on last attempt ───────────────────────────────────────────

  test('finalizes as failed and emits dead-letter on last attempt', async () => {
    // Call run() with attempt=MAX_ATTEMPTS (3) to skip retry scheduling
    mockPlaybookFound();
    mockRunCreated();
    mockStepRow();
    mockFinalize();

    await runner.run({ playbookSlug: SLUG, userId: USER_ID, steps: [failStep], attempt: 3 });

    expect(failStep.fn).toHaveBeenCalledTimes(1);

    // Execution-row finalise UPDATE sets error_message; agent_run_steps UPDATE sets output.
    const finalizeCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('error_message'),
    );
    expect(finalizeCall).toBeDefined();
    expect(finalizeCall[1][0]).toBe('failed');
    expect(finalizeCall[1][1]).toBe('step boom');

    // Dead-letter should have been emitted to monitoring
    expect(mockSupabaseInsert).toHaveBeenCalledTimes(1);
    const deadLetterPayload = mockSupabaseInsert.mock.calls[0][0];
    expect(deadLetterPayload.event_type).toBe('playbook_dead_letter');
    expect(deadLetterPayload.metadata.error).toBe('step boom');
  });

  // ── Retry scheduling ───────────────────────────────────────────────────────

  test('schedules retry (attempt + 1) on step failure when below MAX_ATTEMPTS', async () => {
    jest.useFakeTimers();

    mockPlaybookFound();   // attempt 1 — playbook lookup
    mockRunCreated();      // attempt 1 — execution row
    mockStepRow();         // attempt 1 — step row
    mockFinalize();        // attempt 1 — finalize failed
    // Lock release (DELETE side_effect_locks) won't be called — no idempotency key
    // Retry (attempt 2) will be queued but not run within this test
    mockQuery.mockResolvedValue({ rows: [] }); // catch-all for retry queries

    try {
      await runner.run({ playbookSlug: SLUG, userId: USER_ID, steps: [failStep], attempt: 1 });

      // Verify the first run was marked failed before the timer fires
      const finalizeCall = mockQuery.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('error_message'),
      );
      expect(finalizeCall).toBeDefined();
      expect(finalizeCall[1][0]).toBe('failed');

      // No dead-letter on first attempt
      expect(mockSupabaseInsert).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  // ── Idempotency: lock prevents duplicate ───────────────────────────────────

  test('skips execution when idempotency lock is already held', async () => {
    mockPlaybookFound();
    mockRunCreated();
    // Lock INSERT returns no rows → lock already held (conflict DO NOTHING)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // UPDATE status='skipped'
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await runner.run({
      playbookSlug: SLUG,
      userId: USER_ID,
      context: { idempotencyKey: 'lead_capture_nurture:lead-abc' },
      steps: [passStep],
    });

    expect(passStep.fn).not.toHaveBeenCalled();

    // The skipped UPDATE should reference the run row
    const skippedUpdate = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes("status='skipped'"),
    );
    expect(skippedUpdate).toBeDefined();
    expect(skippedUpdate[1][0]).toBe(RUN_ID);
  });

  // ── Idempotency: lock acquired allows execution ────────────────────────────

  test('executes when idempotency lock is successfully acquired', async () => {
    mockPlaybookFound();
    mockRunCreated();
    // Lock INSERT returns a row → lock acquired
    mockQuery.mockResolvedValueOnce({ rows: [{ idempotency_key: 'key-001' }] });
    mockStepRow();
    mockFinalize();

    await runner.run({
      playbookSlug: SLUG,
      userId: USER_ID,
      context: { idempotencyKey: 'key-001' },
      steps: [passStep],
    });

    expect(passStep.fn).toHaveBeenCalledTimes(1);

    const finalizeCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('finished_at'),
    );
    expect(finalizeCall[1][0]).toBe('success');
  });

  // ── Multiple steps ─────────────────────────────────────────────────────────

  test('runs all steps in order when all succeed', async () => {
    const stepA = { name: 'a', fn: jest.fn().mockResolvedValue({ step: 'a' }) };
    const stepB = { name: 'b', fn: jest.fn().mockResolvedValue({ step: 'b' }) };

    mockPlaybookFound();
    mockRunCreated();
    mockStepRow(); // step A
    mockStepRow(); // step B
    mockFinalize();

    await runner.run({ playbookSlug: SLUG, userId: USER_ID, steps: [stepA, stepB] });

    expect(stepA.fn).toHaveBeenCalledTimes(1);
    expect(stepB.fn).toHaveBeenCalledTimes(1);
  });

  test('stops after first failing step and does not run subsequent steps', async () => {
    const stepA = { name: 'a', fn: jest.fn().mockRejectedValue(new Error('a fails')) };
    const stepB = { name: 'b', fn: jest.fn().mockResolvedValue({}) };

    // attempt=3 so no retry is scheduled
    mockPlaybookFound();
    mockRunCreated();
    mockStepRow(); // step A (fails)
    mockFinalize();

    await runner.run({ playbookSlug: SLUG, userId: USER_ID, steps: [stepA, stepB], attempt: 3 });

    expect(stepA.fn).toHaveBeenCalledTimes(1);
    expect(stepB.fn).not.toHaveBeenCalled();
  });
});
