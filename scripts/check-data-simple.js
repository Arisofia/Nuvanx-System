
const url = 'https://ssvvuuysgxyqvmovrlvk.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzdnZ1dXlzZ3h5cXZtb3ZybHZrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjE5MjE5NiwiZXhwIjoyMDkxNzY4MTk2fQ.QX29reZp-UyOQAh67CTph-LLmQILolPmo1lLZVrpYU8';

async function check() {
  const queries = {
    leads: '/rest/v1/leads?select=id,source&deleted_at=is.null',
    settlements: '/rest/v1/financial_settlements?select=id,amount_net&source_system=eq.doctoralia&cancelled_at=is.null',
    meta: '/rest/v1/meta_daily_insights?select=id&limit=1'
  };

  for (const [name, path] of Object.entries(queries)) {
    try {
      const res = await fetch(`${url}${path}`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Prefer': 'count=exact'
        }
      });
      const count = res.headers.get('Content-Range')?.split('/')[1] || '0';
      console.log(`${name}: ${count} rows`);
    } catch (e) {
      console.error(`Error checking ${name}:`, e.message);
    }
  }
}

check();
