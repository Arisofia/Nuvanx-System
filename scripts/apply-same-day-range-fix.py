from pathlib import Path

path = Path('supabase/functions/api/index.ts')
api = path.read_text()
old = """  const diffTime = Math.abs(new Date(until).getTime() - new Date(since).getTime());
  const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 30;

  return { since, until, days, period: { since, until, range: `${days}d` } };
"""
new = """  const diffTime = Math.abs(new Date(until).getTime() - new Date(since).getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const days = Number.isFinite(diffDays) ? Math.max(1, diffDays) : 30;

  return { since, until, days, period: { since, until, range: `${days}d` } };
"""
if old not in api:
    raise SystemExit('getKpiDateRange diff block not found')
path.write_text(api.replace(old, new, 1))
print('Same-day range now resolves to one day.')
