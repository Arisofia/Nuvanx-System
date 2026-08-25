import { describe, expect, it } from 'vitest';
import { hasServiceRoleBearer } from './service-auth.ts';

function requestWithAuthorization(authorization) {
  const headers = authorization === undefined ? {} : { Authorization: authorization };
  return new Request('https://example.test/functions/v1/daily-aggregates', {
    method: 'POST',
    headers,
    body: '{}',
  });
}

describe('daily-aggregates service-role authorization', () => {
  it('rejects requests with no Authorization header', () => {
    expect(hasServiceRoleBearer(requestWithAuthorization(undefined), 'service-role-secret')).toBe(false);
  });

  it('rejects non-Bearer and incorrect Bearer credentials', () => {
    expect(hasServiceRoleBearer(requestWithAuthorization('Basic service-role-secret'), 'service-role-secret')).toBe(false);
    expect(hasServiceRoleBearer(requestWithAuthorization('Bearer wrong-secret'), 'service-role-secret')).toBe(false);
  });

  it('rejects all requests when the configured service-role key is empty', () => {
    expect(hasServiceRoleBearer(requestWithAuthorization('Bearer service-role-secret'), '   ')).toBe(false);
  });

  it('accepts only the exact configured Bearer service-role key', () => {
    expect(hasServiceRoleBearer(requestWithAuthorization('Bearer service-role-secret'), 'service-role-secret')).toBe(true);
    expect(hasServiceRoleBearer(requestWithAuthorization('bearer   service-role-secret'), 'service-role-secret')).toBe(true);
  });
});
