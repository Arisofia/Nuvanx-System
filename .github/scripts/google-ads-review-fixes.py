from pathlib import Path

marketing_path = Path('frontend/src/pages/MarketingUnified.tsx')
marketing = marketing_path.read_text()
old = """      if (!connection.success) {\n        throw new Error('No se pudo comprobar el estado de Google Ads.')\n      }\n      if (!insights.success) {\n"""
new = """      if (!connection.success) {\n        throw new Error('No se pudo comprobar el estado de Google Ads.')\n      }\n      if (requestSequence !== requestSequenceRef.current) return\n      setState((prev) => ({ ...prev, connection }))\n\n      if (!insights.success) {\n"""
if old not in marketing:
    raise SystemExit('Marketing connection-validation anchor not found')
marketing_path.write_text(marketing.replace(old, new, 1))

frontend_test_path = Path('frontend/tests/marketing-unified-contract.test.ts')
frontend_test = frontend_test_path.read_text()
anchor = """    expect(marketing).toContain('CPC promedio')\n  })\n\n  it('prevents stale range responses and timezone-dependent month starts', () => {\n"""
replacement = """    expect(marketing).toContain('CPC promedio')\n    const connectionSave = marketing.indexOf('setState((prev) => ({ ...prev, connection }))')\n    const dependentValidation = marketing.indexOf('if (!insights.success)')\n    expect(connectionSave).toBeGreaterThan(-1)\n    expect(dependentValidation).toBeGreaterThan(connectionSave)\n  })\n\n  it('prevents stale range responses and timezone-dependent month starts', () => {\n"""
if anchor not in frontend_test:
    raise SystemExit('Frontend contract anchor not found')
frontend_test_path.write_text(frontend_test.replace(anchor, replacement, 1))

api_test_path = Path('supabase/functions/api/google-ads-status-contract.test.mjs')
api_test = api_test_path.read_text()
api_test = api_test.replace(
    "const migration = readFileSync('supabase/migrations/20260825082322_create_google_ads_connection_status_view.sql', 'utf8');",
    "const baselineMigration = readFileSync('supabase/migrations/20260825082322_create_google_ads_connection_status_view.sql', 'utf8');\nconst diagnosticsMigration = readFileSync('supabase/migrations/20260825090205_fix_google_ads_connection_status_diagnostics.sql', 'utf8');",
    1,
)
api_test = api_test.replace(
    """  it('keeps the database surface server-only and secret-free', () => {\n    expect(migration).toContain('with (security_invoker = true)');\n    expect(migration).toContain('revoke all on public.vw_google_ads_connection_status from authenticated');\n    expect(migration).toContain('grant select on public.vw_google_ads_connection_status to service_role');\n    expect(migration).not.toContain('encrypted_key');\n  });\n\n""",
    """  it('keeps the database surface server-only and secret-free', () => {\n    expect(baselineMigration).toContain('with (security_invoker = true)');\n    expect(diagnosticsMigration).toContain('with (security_invoker = true)');\n    expect(diagnosticsMigration).toContain('revoke all on public.vw_google_ads_connection_status from authenticated');\n    expect(diagnosticsMigration).toContain('grant select on public.vw_google_ads_connection_status to service_role');\n    expect(baselineMigration).not.toContain('encrypted_key');\n    expect(diagnosticsMigration).not.toContain('encrypted_key');\n  });\n\n  it('diagnoses credential-only states and normalizes customer IDs', () => {\n    expect(diagnosticsMigration).toContain("select user_id from public.credentials where service = 'google_ads'");\n    expect(diagnosticsMigration).toContain('union');\n    expect(diagnosticsMigration).toContain("'credential_only'::character varying(32)");\n    expect(diagnosticsMigration).toContain('nullif(btrim(coalesce(');\n    expect(diagnosticsMigration).toContain("c.metadata->>'customerId'");\n  });\n\n""",
    1,
)
if 'const diagnosticsMigration' not in api_test or "diagnoses credential-only states" not in api_test:
    raise SystemExit('API contract test patch failed')
api_test_path.write_text(api_test)
