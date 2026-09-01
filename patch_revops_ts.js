const fs = require('fs');
let code = fs.readFileSync('supabase/functions/revops-dispatcher/index.ts', 'utf8');
code = code.replace(
  'const ALLOWED_WORKERS = new Set(["web-lead-reconcile", "deal-factory", "google-data-manager-export", "meta-capi-dispatch"]);',
  'const ALLOWED_WORKERS = new Set(["web-lead-reconcile", "deal-factory", "google-data-manager-export", "meta-capi-dispatch", "whatsapp-outbound-worker"]);'
);
fs.writeFileSync('supabase/functions/revops-dispatcher/index.ts', code);
