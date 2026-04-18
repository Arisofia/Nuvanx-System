'use strict';

/**
 * Revenue Intelligence routes — integration tests
 *
 * Covers: /api/financials, /api/reports, /api/kpis, /api/traceability
 *
 * All external deps are mocked so no real DB or network calls are made.
 */

// ── Silence env validation before server require ──────────────────────────────
process.env.JWT_SECRET    = 'test-jwt-secret-value-minimum-32chars!!';
process.env.ENCRYPTION_KEY = 'test-encryption-key-minimum-32chars!';
process.env.NODE_ENV       = 'test';
process.env.DATABASE_URL   = '';

// ── DB mock ───────────────────────────────────────────────────────────────────
let mockIsAvailable = jest.fn().mockReturnValue(false);
let mockQuery       = jest.fn();
const mockPool      = { query: mockQuery };

jest.mock('../src/db', () => ({
  get pool() { return mockPool; },
  isAvailable: (...args) => mockIsAvailable(...args),
  isProduction: false,
}));

// ── Supabase mocks ────────────────────────────────────────────────────────────
jest.mock('../src/config/supabase', () => ({
  supabaseAdmin: null,
  supabaseFigmaAdmin: null,
}));

// ── dashboard sync mock ───────────────────────────────────────────────────────
jest.mock('../src/services/dashboardSync', () => ({
  syncMetrics: jest.fn().mockResolvedValue({ synced: true }),
  startPeriodicSync: jest.fn(),
  stopPeriodicSync: jest.fn(),
}));

// ── model mocks (used by other routes registered on server) ──────────────────
jest.mock('../src/models/lead', () => ({
  STAGES: ['lead', 'whatsapp', 'appointment', 'treatment', 'closed'],
  create: jest.fn(),
  findByUser: jest.fn().mockResolvedValue([]),
  update: jest.fn(),
  delete: jest.fn(),
  findById: jest.fn(),
}));
jest.mock('../src/models/integration', () => ({
  SERVICES: ['meta', 'whatsapp', 'github', 'openai', 'gemini'],
  getAll: jest.fn().mockResolvedValue([]),
  upsert: jest.fn(),
}));
jest.mock('../src/models/credential', () => ({
  create: jest.fn(),
  listByUser: jest.fn().mockResolvedValue([]),
  delete: jest.fn(),
  getDecryptedKey: jest.fn().mockResolvedValue(null),
}));

// ── Meta service mock ─────────────────────────────────────────────────────────
jest.mock('../src/services/meta', () => ({
  getInsights: jest.fn().mockResolvedValue([]),
  getTrendsData: jest.fn().mockResolvedValue([]),
  getCampaigns: jest.fn().mockResolvedValue([]),
  getCampaignsWithInsights: jest.fn().mockResolvedValue([]),
}));

const request = require('supertest');
const jwt     = require('jsonwebtoken');

const app = require('../src/server');

// ── Helpers ───────────────────────────────────────────────────────────────────

const CLINIC_ID = 'clinic-abc-123';
const USER_ID   = 'user-abc-123';

function makeAuthHeader() {
  const token = jwt.sign(
    { id: USER_ID, email: 'test@example.com' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  );
  return `Bearer ${token}`;
}

const authHeader = makeAuthHeader();

beforeEach(() => {
  jest.clearAllMocks();
  mockIsAvailable.mockReturnValue(false);
});

// =============================================================================
// /api/financials
// =============================================================================

describe('/api/financials', () => {
  describe('401 without auth', () => {
    test('GET /summary', async () => {
      const res = await request(app).get('/api/financials/summary');
      expect(res.status).toBe(401);
    });
    test('GET /settlements', async () => {
      const res = await request(app).get('/api/financials/settlements');
      expect(res.status).toBe(401);
    });
    test('GET /patients', async () => {
      const res = await request(app).get('/api/financials/patients');
      expect(res.status).toBe(401);
    });
  });

  describe('503 when DB unavailable', () => {
    test('GET /summary', async () => {
      const res = await request(app)
        .get('/api/financials/summary')
        .set('Authorization', authHeader);
      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
    });
    test('GET /settlements', async () => {
      const res = await request(app)
        .get('/api/financials/settlements')
        .set('Authorization', authHeader);
      expect(res.status).toBe(503);
    });
    test('GET /patients', async () => {
      const res = await request(app)
        .get('/api/financials/patients')
        .set('Authorization', authHeader);
      expect(res.status).toBe(503);
    });
  });

  describe('200 when DB available but no clinic_id', () => {
    beforeEach(() => {
      mockIsAvailable.mockReturnValue(true);
      // clinic_id lookup returns null
      mockQuery.mockResolvedValue({ rows: [{ clinic_id: null }] });
    });

    test('GET /summary returns zeroed summary', async () => {
      const res = await request(app)
        .get('/api/financials/summary')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.summary.totalNet).toBe(0);
      expect(res.body.monthly).toEqual([]);
    });

    test('GET /settlements returns empty array', async () => {
      const res = await request(app)
        .get('/api/financials/settlements')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.settlements).toEqual([]);
    });

    test('GET /patients returns empty array', async () => {
      const res = await request(app)
        .get('/api/financials/patients')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.patients).toEqual([]);
    });
  });

  describe('200 with data when DB available and clinic_id set', () => {
    beforeEach(() => {
      mockIsAvailable.mockReturnValue(true);
    });

    test('GET /summary returns real aggregate data', async () => {
      // clinic_id lookup
      mockQuery.mockResolvedValueOnce({ rows: [{ clinic_id: CLINIC_ID }] });
      // summary aggregate
      mockQuery.mockResolvedValueOnce({
        rows: [{
          settled_count: '10', cancelled_count: '2',
          total_net: '5000', total_gross: '5500', total_discount: '500',
          avg_ticket: '500', avg_liquidation_days: '5.2',
        }],
      });
      // monthly chart
      mockQuery.mockResolvedValueOnce({ rows: [{ month: 'Apr 25', net: '5000' }] });
      // template mix
      mockQuery.mockResolvedValueOnce({ rows: [{ name: 'Ortodoncia', count: '5', net: '2500' }] });

      const res = await request(app)
        .get('/api/financials/summary')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.summary.totalNet).toBe(5000);
      expect(res.body.summary.settledCount).toBe(10);
      expect(res.body.monthly).toHaveLength(1);
      expect(res.body.templateMix).toHaveLength(1);
      // pct = template.net / totalNet × 100 = 2500/5000×100 = 50
      expect(res.body.templateMix[0].pct).toBe(50);
      // net value is passed through as float
      expect(res.body.templateMix[0].net).toBe(2500);
    });

    test('GET /summary calculates pct correctly with multiple templates', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ clinic_id: CLINIC_ID }] });
      mockQuery.mockResolvedValueOnce({
        rows: [{
          settled_count: '3', cancelled_count: '0',
          total_net: '1000', total_gross: '1000', total_discount: '0',
          avg_ticket: '333', avg_liquidation_days: '0',
        }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // Two templates: 600 + 400 = 1000 total
      mockQuery.mockResolvedValueOnce({
        rows: [
          { name: 'A', count: '2', net: '600' },
          { name: 'B', count: '1', net: '400' },
        ],
      });

      const res = await request(app)
        .get('/api/financials/summary')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.templateMix).toHaveLength(2);
      expect(res.body.templateMix[0].pct).toBe(60);  // 600/1000
      expect(res.body.templateMix[1].pct).toBe(40);  // 400/1000
    });

    test('GET /settlements returns rows', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ clinic_id: CLINIC_ID }] }); // clinic_id
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'OP-001', patient_name: 'Ana G', amount_net: '300' }],
      });

      const res = await request(app)
        .get('/api/financials/settlements')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.settlements).toHaveLength(1);
      expect(res.body.settlements[0].id).toBe('OP-001');
    });
  });
});

// =============================================================================
// /api/reports
// =============================================================================

describe('/api/reports', () => {
  test('401 without auth — doctoralia-financials', async () => {
    const res = await request(app).get('/api/reports/doctoralia-financials');
    expect(res.status).toBe(401);
  });

  test('503 when DB unavailable — doctoralia-financials', async () => {
    const res = await request(app)
      .get('/api/reports/doctoralia-financials')
      .set('Authorization', authHeader);
    expect(res.status).toBe(503);
  });

  test('503 when DB unavailable — campaign-performance', async () => {
    const res = await request(app)
      .get('/api/reports/campaign-performance')
      .set('Authorization', authHeader);
    expect(res.status).toBe(503);
  });

  test('200 with real data when DB + clinic available', async () => {
    mockIsAvailable.mockReturnValue(true);
    mockQuery.mockResolvedValueOnce({ rows: [{ clinic_id: CLINIC_ID }] }); // clinic_id
    mockQuery.mockResolvedValueOnce({                                        // byMonth
      rows: [{ settled_month: '2025-04-01', operations_count: '5', total_net: '2000' }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });                           // templateSummary

    const res = await request(app)
      .get('/api/reports/doctoralia-financials')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.byMonth).toHaveLength(1);
    expect(res.body.templateSummary).toHaveLength(0);
  });

  test('200 campaign-performance returns rows', async () => {
    mockIsAvailable.mockReturnValue(true);
    mockQuery.mockResolvedValueOnce({
      rows: [{ campaign_name: 'Spring 2025', total_leads: '20' }],
    });

    const res = await request(app)
      .get('/api/reports/campaign-performance')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.campaigns).toHaveLength(1);
    expect(res.body.campaigns[0].campaign_name).toBe('Spring 2025');
  });
});

// =============================================================================
// /api/kpis
// =============================================================================

describe('/api/kpis', () => {
  test('401 without auth', async () => {
    const res = await request(app).get('/api/kpis');
    expect(res.status).toBe(401);
  });

  test('503 when DB unavailable', async () => {
    const res = await request(app)
      .get('/api/kpis')
      .set('Authorization', authHeader);
    expect(res.status).toBe(503);
  });

  test('200 with real data', async () => {
    mockIsAvailable.mockReturnValue(true);
    // clinic_id lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ clinic_id: CLINIC_ID }] });
    // doctoralia KPIs (clinic-scoped)
    mockQuery.mockResolvedValueOnce({
      rows: [{
        settled_count: '8', cancelled_count: '1',
        total_net: '3200', total_gross: '3500', total_discount: '300',
        avg_ticket: '400', avg_liquidation_days: '3.1',
      }],
    });
    // acquisition KPIs
    mockQuery.mockResolvedValueOnce({
      rows: [{ total_leads: '15', contacted: '12', replied: '9' }],
    });
    // blocked KPI catalogue
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/kpis')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.doctoralia.totalNet).toBe(3200);
    expect(res.body.acquisition.totalLeads).toBe(15);
    expect(res.body.acquisition.replyRate).toBeCloseTo(75);
    expect(res.body.blocked).toHaveLength(0);
  });
});

// =============================================================================
// /api/traceability
// =============================================================================

describe('/api/traceability', () => {
  test('401 without auth — funnel', async () => {
    const res = await request(app).get('/api/traceability/funnel');
    expect(res.status).toBe(401);
  });

  test('503 when DB unavailable — funnel', async () => {
    const res = await request(app)
      .get('/api/traceability/funnel')
      .set('Authorization', authHeader);
    expect(res.status).toBe(503);
  });

  test('503 when DB unavailable — leads', async () => {
    const res = await request(app)
      .get('/api/traceability/leads')
      .set('Authorization', authHeader);
    expect(res.status).toBe(503);
  });

  test('200 funnel with real data', async () => {
    mockIsAvailable.mockReturnValue(true);
    mockQuery.mockResolvedValueOnce({
      rows: [
        { cohort: 'not_contacted', lead_count: '5', estimated_revenue: '0', verified_revenue_crm: '0', avg_reply_delay_min: null },
        { cohort: 'attended_closed', lead_count: '2', estimated_revenue: '1500', verified_revenue_crm: '1800', avg_reply_delay_min: '8.2' },
      ],
    });

    const res = await request(app)
      .get('/api/traceability/funnel')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.funnel).toHaveLength(2);
    expect(res.body.funnel[0].cohort).toBe('not_contacted');
    // null avg_reply_delay_min must survive JSON serialisation as null (not NaN/undefined)
    expect(res.body.funnel[0].avg_reply_delay_min).toBeNull();
    expect(res.body.funnel[1].avg_reply_delay_min).toBe('8.2');
  });

  test('200 leads with Doctoralia join data', async () => {
    mockIsAvailable.mockReturnValue(true);
    // clinic_id lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ clinic_id: CLINIC_ID }] });
    // leads query with joins
    mockQuery.mockResolvedValueOnce({
      rows: [{
        lead_id: 'lead-001', lead_name: 'Carlos M',
        source: 'meta', stage: 'closed',
        campaign_name: 'Spring Promo',
        estimated_revenue: '900', crm_verified_revenue: '950',
        doctoralia_template: 'Ortodoncia', doctoralia_net: '950',
      }],
    });

    const res = await request(app)
      .get('/api/traceability/leads')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.leads).toHaveLength(1);
    expect(res.body.leads[0].doctoralia_template).toBe('Ortodoncia');
  });
});
