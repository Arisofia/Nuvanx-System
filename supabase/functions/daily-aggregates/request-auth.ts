export function hasServiceRoleBearer(request: Request, serviceRoleKey: string): boolean {
  const expectedToken = serviceRoleKey.trim();
  if (!expectedToken) return false;

  const authorization = request.headers.get('authorization');
  if (!authorization) return false;

  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) return false;

  return match[1].trim() === expectedToken;
}

async function sha256Bytes(raw: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
}

export async function secretMatches(received: string, expected: string): Promise<boolean> {
  const normalizedReceived = String(received || '').trim();
  const normalizedExpected = String(expected || '').trim();
  if (!normalizedReceived || !normalizedExpected) return false;

  const a = await sha256Bytes(normalizedReceived);
  const b = await sha256Bytes(normalizedExpected);
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
