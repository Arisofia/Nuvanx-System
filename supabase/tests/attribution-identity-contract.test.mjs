import assert from 'node:assert/strict';
import fs from 'node:fs';

const capture = fs.readFileSync('supabase/functions/lead-captured/index.ts', 'utf8');
const reconcile = fs.readFileSync('supabase/functions/web-lead-reconcile/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260831031258_canonical_attribution_identity_and_qa_cleanup.sql', 'utf8');

assert.match(capture, /"fbclid", "fbc", "fbp"/);
assert.match(capture, /marketingConsent \? cleanAttribution\(body\.conversion_attribution\) : \{\}/);
assert.match(capture, /FBP is never synthesized/);
assert.match(reconcile, /fbc: capture\.marketing_consent === true \? attrValue\(capture, "fbc"\) : null/);
assert.match(reconcile, /fbp: capture\.marketing_consent === true \? attrValue\(capture, "fbp"\) : null/);
assert.match(migration, /IF v_count NOT IN \(0, 14\) THEN/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.nvx_get_attribution_health\(\)/);
assert.doesNotMatch(migration, /stage\s*=\s*'convertido'/);
assert.doesNotMatch(migration, /verified_revenue\s*=/);

console.log('ATTRIBUTION_IDENTITY_EDGE_CONTRACT=PASS consent=1 meta_identity=1 replay_safe=1');
