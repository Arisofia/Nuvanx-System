import { describe, expect, it, vi } from 'vitest';
import {
  buildMetaAppSecretCandidates,
  isInvalidMetaAppSecretProof,
  shouldRetryMetaAppSecretProof,
} from '../_shared/meta-appsecret.mjs';

async function runFallback({ canonical, legacy, override, responses }) {
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
  it('orders canonical, legacy and bare-token fallback deterministically', () => {
    expect(buildMetaAppSecretCandidates(' canonical ', 'legacy')).toEqual(['canonical', 'legacy', null]);
    expect(buildMetaAppSecretCandidates('same', 'same')).toEqual(['same', null]);
    expect(buildMetaAppSecretCandidates('', '')).toEqual([null]);
  });

  it('keeps explicit overrides strict, including explicit no-proof mode', () => {
    expect(buildMetaAppSecretCandidates('canonical', 'legacy', 'override')).toEqual(['override']);
    expect(buildMetaAppSecretCandidates('canonical', 'legacy', null)).toEqual([null]);
  });

  it('retries only invalid appsecret_proof failures and reaches bare-token success', async () => {
    const outcome = await runFallback({
      canonical: 'canonical',
      legacy: 'legacy',
      responses: [
        { ok: false, body: { error: { message: 'Invalid appsecret_proof provided' } } },
        { ok: false, body: { error: { message: 'Invalid App Secret Proof' } } },
        { ok: true, body: { data: [{ id: 'ok' }] } },
      ],
    });
    expect(outcome.candidates).toEqual(['canonical', 'legacy', null]);
    expect(outcome.attempt.mock.calls.map(([secret]) => secret)).toEqual(['canonical', 'legacy', null]);
    expect(outcome.result.ok).toBe(true);
  });

  it('does not retry unrelated Meta errors', async () => {
    const body = { error: { message: 'Unsupported get request' } };
    expect(isInvalidMetaAppSecretProof(body)).toBe(false);
    const outcome = await runFallback({
      canonical: 'canonical',
      legacy: 'legacy',
      responses: [{ ok: false, body }, { ok: true, body: {} }],
    });
    expect(outcome.attempt).toHaveBeenCalledTimes(1);
    expect(outcome.result.ok).toBe(false);
  });
});
