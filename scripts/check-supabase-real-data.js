import { createClient } from '@supabase/supabase-js';

const required = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
];

const missing = required.filter((key) => !process.env[key]?.trim());

if (missing.length > 0) {
  console.error(`Missing required Supabase env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

const { data, error } = await supabase
  .from('integrations')
  .select('*')
  .limit(1);

if (error) {
  console.error('Supabase real-data check failed:', error.message);
  process.exit(1);
}

if (!Array.isArray(data)) {
  console.error('Supabase real-data check failed: response is not an array.');
  process.exit(1);
}

console.log(`Supabase real-data check passed. Rows returned: ${data.length}`);
