'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum!!';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-min!';
process.env.NODE_ENV = 'test';
// Prevent dotenv from overwriting our empty values with real .env credentials
process.env.OPENAI_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.META_ACCESS_TOKEN = '';
process.env.GITHUB_PAT = '';
process.env.GITHUB_TOKEN_CLASSIC = '';
process.env.GITHUB_TOKEN = '';

const request = require('supertest');
const jwt = require('jsonwebtoken');

// ── Mock the database module BEFORE requiring server ────────────────────────
// jest.mock is hoisted, so the factory runs before any require in the test body.
jest.mock('../src/db', () => {
  const mockQuery = jest.fn();
  const mockIsAvailable = jest.fn().mockReturnValue(true);
  return {
    // Expose pool as a plain property (not a getter) so destructuring
    // in route files captures the mock object correctly.
    pool: { query: mockQuery },
    isAvailable: mockIsAvailable,
    isProduction: false,
  };
});

// Mock lead model (required by other routes loaded with the server)
jest.mock('../src/models/lead', () => ({
  STAGES: ['lead', 'whatsapp', 'appointment', 'treatment', 'closed'],
  findByUser: jest.fn().mockResolvedValue([]),
  findById: jest.fn().mockResolvedValue(null),
  create: jest.fn().mockResolvedValue(null),
  update: jest.fn().mockResolvedValue(null),
  remove: jest.fn().mockResolvedValue(false),
  findOrMerge: jest.fn().mockResolvedValue({ lead: null, merged: false }),
}));

const app = require('../src/server');

// Access the mock functions through requireMock so we can set up responses
const db = require('../src/db');
const mockQuery = db.pool.query;
const mockIsAvailable = db.isAvailable;

// ── Test fixtures ────────────────────────────────────────────────────────────
const TEST_USER = {
  id: 'doctoralia-user-001',
  email: 'doc@nuvanx.com',
  name: 'Doctoralia Tester',
};
const authToken = jwt.sign(TEST_USER, process.env.JWT_SECRET, { expiresIn: '1h' });
const authHeader = `Bearer ${authToken}`;

const CLINIC_ID = 'a0000000-0000-0000-0000-000000000001';
const PATIENT_ID = 'b0000000-0000-0000-0000-000000000001';

const validRow = {
  idoperacion: 'OP-001',
  paciente: 'García López, María',
  dni: '12345678A',
  plantillaid: 'TPL-01',
  plantilladescr: 'Tratamiento Premium',
  importebruto: '1200.00',
  importedescuento: '100.00',
  importeneto: '1100.00',
  fechaoperacion: '2026-01-15',
  fechaentrada: '2026-01-10',
  metodopago: 'Financed',
  estado: 'activo',
};

// ── Helper: set up DB mock responses for a successful single-row ingest ──────
// Actual execution order:
//   1. clinic_id lookup  (before transaction opens)
//   2. BEGIN
//   3. SAVEPOINT sp      (per row)
//   4. patient upsert
//   5. settlement upsert
//   6. RELEASE SAVEPOINT sp
//   7. COMMIT
//   8. reconcile_patient_leads (async / fire-and-forget)
function setupSuccessfulIngest({ isInsert = true } = {}) {
  mockIsAvailable.mockReturnValue(true);
  // 1. clinic_id lookup
  mockQuery.mockResolvedValueOnce({ rows: [{ clinic_id: CLINIC_ID }] });
  // 2. BEGIN
  mockQuery.mockResolvedValueOnce({ rows: [] });
  // 3. SAVEPOINT sp
  mockQuery.mockResolvedValueOnce({ rows: [] });
  // 4. patient upsert
  mockQuery.mockResolvedValueOnce({ rows: [{ id: PATIENT_ID }] });
  // 5. settlement upsert
  mockQuery.mockResolvedValueOnce({ rows: [{ is_insert: isInsert }] });
  // 6. RELEASE SAVEPOINT sp
  mockQuery.mockResolvedValueOnce({ rows: [] });
  // 7. COMMIT
  mockQuery.mockResolvedValueOnce({ rows: [] });
  // 8. async reconcile_patient_leads (fire-and-forget)
  mockQuery.mockResolvedValue({ rows: [] });
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('Doctoralia Ingest API', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockIsAvailable.mockReturnValue(true);
  });

  // ── Authentication ─────────────────────────────────────────────────────────
  test('401 without auth token', async () => {
    const res = await request(app)
      .post('/api/doctoralia/ingest')
      .send({ rows: [validRow] });

    expect(res.status).toBe(401);
  });

  // ── Body validation ────────────────────────────────────────────────────────
  test('400 when rows field is missing', async () => {
    const res = await request(app)
      .post('/api/doctoralia/ingest')
      .set('Authorization', authHeader)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('400 when rows is an empty array', async () => {
    const res = await request(app)
      .post('/api/doctoralia/ingest')
      .set('Authorization', authHeader)
      .send({ rows: [] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // ── DB availability ────────────────────────────────────────────────────────
  test('503 when database is not available', async () => {
    mockIsAvailable.mockReturnValue(false);

    const res = await request(app)
      .post('/api/doctoralia/ingest')
      .set('Authorization', authHeader)
      .send({ rows: [validRow] });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  // ── Clinic linkage ─────────────────────────────────────────────────────────
  test('400 when user is not linked to a clinic', async () => {
    // clinic_id lookup — returns null (before transaction)
    mockQuery.mockResolvedValueOnce({ rows: [{ clinic_id: null }] });
    // catch-all for any other potential calls
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post('/api/doctoralia/ingest')
      .set('Authorization', authHeader)
      .send({ rows: [validRow] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/clinic/i);
  });

  // ── Successful insert ──────────────────────────────────────────────────────
  test('inserts a new settlement and returns correct counts', async () => {
    setupSuccessfulIngest({ isInsert: true });

    const res = await request(app)
      .post('/api/doctoralia/ingest')
      .set('Authorization', authHeader)
      .send({ rows: [validRow] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.inserted).toBe(1);
    expect(res.body.updated).toBe(0);
    expect(res.body.patients_upserted).toBe(1);
    expect(res.body.errors).toHaveLength(0);
  });

  // ── Idempotency ────────────────────────────────────────────────────────────
  test('repeated ingest increments updated not inserted', async () => {
    setupSuccessfulIngest({ isInsert: false });

    const res = await request(app)
      .post('/api/doctoralia/ingest')
      .set('Authorization', authHeader)
      .send({ rows: [validRow] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.inserted).toBe(0);
    expect(res.body.updated).toBe(1);
    expect(res.body.errors).toHaveLength(0);
  });

  // ── Cancelled estado ───────────────────────────────────────────────────────
  test('cancelled estado passes non-null cancelled_at to settlement query', async () => {
    setupSuccessfulIngest({ isInsert: true });

    const cancelledRow = { ...validRow, idoperacion: 'OP-CANCEL', estado: 'cancelado' };

    const res = await request(app)
      .post('/api/doctoralia/ingest')
      .set('Authorization', authHeader)
      .send({ rows: [cancelledRow] });

    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);

    // Locate the settlement INSERT call among all mock calls
    // It's the only call whose first param is an SQL string containing 'financial_settlements'
    const settlementCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('financial_settlements'),
    );
    expect(settlementCall).toBeDefined();
    // cancelled_at is the 12th parameter (index 11) in the VALUES list
    const cancelledAt = settlementCall[1][11];
    expect(cancelledAt).not.toBeNull();
    expect(cancelledAt).toBe('2026-01-15'); // equals fechaoperacion when cancelled
  });

  test('active estado keeps cancelled_at as null', async () => {
    setupSuccessfulIngest({ isInsert: true });

    const res = await request(app)
      .post('/api/doctoralia/ingest')
      .set('Authorization', authHeader)
      .send({ rows: [validRow] }); // estado: 'activo'

    expect(res.status).toBe(200);

    const settlementCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('financial_settlements'),
    );
    const cancelledAt = settlementCall[1][11];
    expect(cancelledAt).toBeNull();
  });

  // ── Row-level error handling ───────────────────────────────────────────────
  test('rows with missing idoperacion are counted as errors', async () => {
    // clinic_id lookup (before transaction)
    mockQuery.mockResolvedValueOnce({ rows: [{ clinic_id: CLINIC_ID }] });
    // BEGIN, SAVEPOINT, RELEASE SAVEPOINT, COMMIT and any other calls
    mockQuery.mockResolvedValue({ rows: [] });

    const badRow = { ...validRow, idoperacion: '' };

    const res = await request(app)
      .post('/api/doctoralia/ingest')
      .set('Authorization', authHeader)
      .send({ rows: [badRow] });

    expect(res.status).toBe(200);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.inserted).toBe(0);
    expect(res.body.updated).toBe(0);
  });

  test('rows with missing fechaoperacion are counted as errors', async () => {
    // clinic_id lookup (before transaction)
    mockQuery.mockResolvedValueOnce({ rows: [{ clinic_id: CLINIC_ID }] });
    // BEGIN, SAVEPOINT, RELEASE SAVEPOINT, COMMIT and any other calls
    mockQuery.mockResolvedValue({ rows: [] });

    const badRow = { ...validRow, idoperacion: 'OP-NODATE', fechaoperacion: '' };

    const res = await request(app)
      .post('/api/doctoralia/ingest')
      .set('Authorization', authHeader)
      .send({ rows: [badRow] });

    expect(res.status).toBe(200);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.inserted).toBe(0);
  });

  // ── Multiple rows ──────────────────────────────────────────────────────────
  test('processes multiple rows and totals counts correctly', async () => {
    // clinic_id lookup (before transaction)
    mockQuery.mockResolvedValueOnce({ rows: [{ clinic_id: CLINIC_ID }] });
    // BEGIN
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Row 1 — insert
    mockQuery.mockResolvedValueOnce({ rows: [] });                        // SAVEPOINT
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PATIENT_ID }] });     // patient upsert
    mockQuery.mockResolvedValueOnce({ rows: [{ is_insert: true }] });    // settlement insert
    mockQuery.mockResolvedValueOnce({ rows: [] });                        // RELEASE SAVEPOINT

    // Row 2 — update
    mockQuery.mockResolvedValueOnce({ rows: [] });                        // SAVEPOINT
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'patient-002' }] });  // patient upsert
    mockQuery.mockResolvedValueOnce({ rows: [{ is_insert: false }] });   // settlement update
    mockQuery.mockResolvedValueOnce({ rows: [] });                        // RELEASE SAVEPOINT

    // COMMIT + async reconcile calls
    mockQuery.mockResolvedValue({ rows: [] });

    const row2 = { ...validRow, idoperacion: 'OP-002', dni: '87654321B' };

    const res = await request(app)
      .post('/api/doctoralia/ingest')
      .set('Authorization', authHeader)
      .send({ rows: [validRow, row2] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.inserted).toBe(1);
    expect(res.body.updated).toBe(1);
    expect(res.body.patients_upserted).toBe(2);
    expect(res.body.errors).toHaveLength(0);
  });

  // ── reconcile_patient_leads call ───────────────────────────────────────────
  test('calls reconcile_patient_leads (not reconcile_lead_to_patient) after patient upsert', async () => {
    setupSuccessfulIngest({ isInsert: true });

    await request(app)
      .post('/api/doctoralia/ingest')
      .set('Authorization', authHeader)
      .send({ rows: [validRow] });

    // Give the fire-and-forget promise a tick to resolve
    await new Promise((r) => setImmediate(r));

    const reconcileCalls = mockQuery.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('reconcile_patient_leads'),
    );
    expect(reconcileCalls.length).toBeGreaterThan(0);
    expect(reconcileCalls[0][1][0]).toBe(PATIENT_ID);
  });
});
