import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./meta-apply-rsv26.js', import.meta.url), 'utf8');

const guardStart = source.indexOf('async function assertSourceCreativeUnchanged');
const guardEnd = source.indexOf('\n}\n\nfunction creativeCreateParams', guardStart);
assert.ok(guardStart >= 0 && guardEnd > guardStart, 'source creative concurrency guard must exist');
const guardSource = source.slice(guardStart, guardEnd);

assert.match(
  guardSource,
  /if \(!same\(freshDesired, expectedDesired\)\)/,
  'source concurrency must compare the complete desired creative, including preserved fields',
);
assert.doesNotMatch(
  guardSource,
  /creativeMatches\(/,
  'source concurrency must not use the projected creative contract comparator',
);
assert.match(
  source,
  /function creativeCreateParams\(entry, desired, runId\)/,
  'creative creation must receive the freshly fenced desired creative explicitly',
);
assert.match(
  source,
  /creativeCreateParams\(entry, freshDesired, runId\)/,
  'staged creative must be built from the fresh source read rather than the initial snapshot',
);

const tryIndex = source.indexOf('try {');
const pauseIndex = source.indexOf('  if (temporarilyPause) {', tryIndex);
const stageIndex = source.indexOf('  if (selection.creatives) {', tryIndex);
assert.ok(
  pauseIndex >= 0 && stageIndex >= 0 && pauseIndex < stageIndex,
  'campaign must be paused before creative staging when a material mutation requires a pause',
);

for (const phase of [
  'before staging',
  'after staging',
  'before ad assignment',
  'after ad assignment',
  'before status restoration',
]) {
  assert.ok(source.includes(`'${phase}'`), `missing source creative revision fence: ${phase}`);
}

assert.match(
  source,
  /stagedCreativeDesired\.set\(entry\.item\.key, freshDesired\)/,
  'the exact desired creative used for staging must be retained as the concurrency fence',
);
assert.match(
  source,
  /rollbackOps\.push\([\s\S]*?type: 'ad'[\s\S]*?\);\n    if \(creativeId\) \{\n      await assertSourceCreativeUnchanged\(entry, expectedDesired, 'after ad assignment'\);/,
  'post-assignment source validation must occur only after rollback state is registered',
);

console.log('meta-apply-rsv26 concurrency contract: PASS');
