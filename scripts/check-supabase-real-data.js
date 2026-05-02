(async () => {
  const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];
  const missing = required.filter((key) => !process.env[key]?.trim());

  if (missing.length > 0) {
    console.error(`Missing required Supabase env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  const url = process.env.VITE_SUPABASE_URL.replace(/\/$/, '');
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const res = await fetch(`${url}/rest/v1/integrations?select=id&limit=1`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Supabase real-data check failed: HTTP ${res.status}`, text.slice(0, 300));
    process.exit(1);
  }

  const data = await res.json();

  if (!Array.isArray(data)) {
    console.error('Supabase real-data check failed: response is not an array.');
    process.exit(1);
  }

  console.log(`Supabase real-data check passed. Rows returned: ${data.length}`);
})().catch((err) => {
  console.error('Supabase real-data check failed with error:', err);
  process.exit(1);
});
