export function hasServiceRoleBearer(request: Request, serviceRoleKey: string): boolean {
  const expectedToken = serviceRoleKey.trim();
  if (!expectedToken) return false;

  const authorization = request.headers.get('authorization');
  if (!authorization) return false;

  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) return false;

  return match[1].trim() === expectedToken;
}
