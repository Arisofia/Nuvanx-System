import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/seo-web-performance/index.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260905141000_add_seo_web_performance_runtime.sql', 'utf8');
const page = readFileSync('frontend/src/pages/SEOTracker.tsx', 'utf8');
const hook = readFileSync('frontend/src/hooks/useSeoWebPerformance.ts', 'utf8');

describe('SEO web performance runtime telemetry contract', () => {
  it('uses the canonical PageSpeed endpoint over the six critical production routes and both devices', () => {
    expect(source).toContain('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    for (const route of [
      '/',
      '/endolift-facial-papada-mandibula/',
      '/endolaser-corporal-grasa-localizada/',
      '/medicina-estetica/',
      '/madrid/valoracion/',
      '/blog/',
    ]) {
      expect(source).toContain(`"${route}"`);
    }
    expect(source).toContain('const DEVICES = ["mobile", "desktop"] as const;');
  });

  it('persists provider failures, surfaces a failed run, and never substitutes estimated metrics', () => {
    expect(source).toContain('quality_status: "unavailable"');
    expect(source).toContain('provider_contract_incomplete');
    expect(source).toContain('.from("seo_web_performance").insert(rows)');
    expect(source).toContain('return reply(fullyAvailable ? 200 : 502');
    expect(source).not.toContain('322');
    expect(source).not.toContain('4939');
    expect(source).not.toContain('24.46');
  });

  it('keeps the scheduler inside the existing Vault/internal-secret trust boundary', () => {
    expect(migration).toContain("WHERE name = 'REVOPS_INTERNAL_SECRET'");
    expect(migration).toContain("WHERE name = 'REVOPS_PROJECT_URL'");
    expect(migration).toContain("'x-nvx-internal-secret', v_secret");
    expect(migration).toContain("'nvx-seo-web-performance-daily'");
    expect(migration).toContain("'25 5 * * *'");
    expect(migration).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('allows authenticated reads but keeps all browser writes closed', () => {
    expect(migration).toContain('GRANT SELECT ON TABLE public.seo_web_performance TO authenticated;');
    expect(migration).toContain('GRANT ALL ON TABLE public.seo_web_performance TO service_role;');
    expect(migration).not.toContain('GRANT INSERT ON TABLE public.seo_web_performance TO authenticated');
    expect(migration).toContain("(SELECT auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'");
  });

  it('renders only runtime rows and enforces the 48-hour stale contract', () => {
    expect(hook).toContain(".from('seo_web_performance')");
    expect(hook).toContain('48 * 60 * 60 * 1000');
    expect(hook).toContain("row.quality_status === 'partial'");
    expect(page).toContain('PageSpeed / Lighthouse');
    expect(page).toContain('INP sólo se publica cuando Google expone field data');
    expect(page).not.toContain('322 clics');
    expect(page).not.toContain('4.939');
  });
});
