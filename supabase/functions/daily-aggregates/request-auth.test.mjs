import { describe, expect, it } from 'vitest';
import { hasServiceRoleBearer, secretMatches } from './request-auth.ts';

function requestWithAuthorization(authorization) {
  const headers = authorization === undefined ? {} : { Authorization: authorization };
  return new Request('https://example.test/functions/v1/daily-aggregates', {
    method: 'POST',
    headers,
    body: '{}',
  });
}

describe('daily-aggregates request authorization', () => {
  it('rejects missing, malformed and incorrect service-role credentials', () => {
    expect(hasServiceRoleBearer(requestWithAuthorization(undefined), 'service-role-secret')).toBe(false);
    expect(hasServiceRoleBearer(requestWithAuthorization('Basic service-role-secret'), 'service-role-secret')).toBe(false);
    expect(hasServiceRoleBearer(requestWithAuthorization('Bearer wrong-secret'), 'service-role-secret')).toBe(false);
    expect(hasServiceRoleBearer(requestWithAuthorization('Bearer service-role-secret'), '   ')).toBe(false);
  });

  it('accepts the exact configured service-role Bearer credential', () => {
    expect(hasServiceRoleBearer(requestWithAuthorization('Bearer service-role-secret'), 'service-role-secret')).toBe(true);
    expect(hasServiceRoleBearer(requestWithAuthorization('bearer   service-role-secret'), 'service-role-secret')).toBe(true);
  });

  it('matches the internal scheduler secret only when both non-empty values are exact', async () => {
    await expect(secretMatches('', 'internal-secret')).resolves.toBe(false);
    await expect(secretMatches('internal-secret', '')).resolves.toBe(false);
    await expect(secretMatches('wrong-secret', 'internal-secret')).resolves.toBe(false);
    await expect(secretMatches(' internal-secret ', 'internal-secret')).resolves.toBe(true);
  });
});
