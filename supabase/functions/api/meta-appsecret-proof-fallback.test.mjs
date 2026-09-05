import { describe, expect, it, vi } from 'vitest';
import {
  buildMetaAppSecretCandidates,
  isInvalidMetaAppSecretProof,
  shouldRetryMetaAppSecretProof,
} from '../_shared/meta-appsecret.mjs';

async function runCandidates({ canonical, legacy, override, responses }) {
  const candidates = buildMetaAppSecretCandidates(canonical, legacy, override);
  const attempt = vi.fn(async (candidate, index) => responses[index]);
  let last;
  for (let index = 0; index < candidates.length; index += 1) {
    last = await attempt(candidates[index], index);
    if (last.ok) return { result: last, candidates, attempt };
    if (!shouldRetryMetaAppSecretProof(index, candidates, last.body)) break;
  }
  return { result: last, candidates, attempt };
}

describe('Meta appsecret proof routing', () => {
  it('keeps exactly one canonical candidate and never degrades to legacy or bare token', () => {
    expect(buildMetaAppSecretCandidates(' canonical ', 'legacy')).toEqual(['canonical']);
    expect(buildMetaAppSecretCandidates('same', 'same')).toEqual(['same']);
    expect(() => buildMetaAppSecretCandidates('', 'legacy')).toThrow(/Canonical Meta App Secret is required/);
    expect(() => buildMetaAppSecretCandidates('', '')).toThrow(/Canonical Meta App Secret is required/);
  });

  it('keeps explicit service-owner overrides strict, including explicit legacy no-proof mode', () => {
    expect(buildMetaAppSecretCandidates('canonical', 'legacy', 'override')).toEqual(['override']);
    expect(buildMetaAppSecretCandidates('canonical', 'legacy', null)).toEqual([null]);
  });

  it('does not retry canonical appsecret_proof failures through another authority', async () => {
    const outcome = await runCandidates({
      canonical: 'canonical',
      legacy: 'legacy',
      responses: [
        { ok: false, body: { error: { message: 'Invalid appsecret_proof provided' } } },
        { ok: true, body: { data: [{ id: 'must-not-run' }] } },
      ],
    });
    expect(outcome.candidates).toEqual(['canonical']);
    expect(outcome.attempt.mock.calls.map(([secret]) => secret)).toEqual(['canonical']);
    expect(outcome.result.ok).toBe(false);
  });

  it('does not retry unrelated Meta errors', async () => {
    const body = { error: { message: 'Unsupported get request' } };
    expect(isInvalidMetaAppSecretProof(body)).toBe(false);
    const outcome = await runCandidates({
      canonical: 'canonical',
      legacy: 'legacy',
      responses: [{ ok: false, body }, { ok: true, body: {} }],
    });
    expect(outcome.attempt).toHaveBeenCalledTimes(1);
    expect(outcome.result.ok).toBe(false);
  });
});
