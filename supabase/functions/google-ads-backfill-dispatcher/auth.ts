export type InternalAuthResult =
  | { ok: true }
  | { ok: false; status: 403 | 500; message: string };

async function sha256Bytes(raw: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
}

async function secretMatches(received: string, expected: string): Promise<boolean> {
  const normalizedReceived = String(received || "").trim();
  const normalizedExpected = String(expected || "").trim();
  if (!normalizedReceived || !normalizedExpected) return false;

  const a = await sha256Bytes(normalizedReceived);
  const b = await sha256Bytes(normalizedExpected);
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function authenticateInternalRequest(
  req: Request,
  resolveExpectedSecret: () => Promise<string | null | undefined>,
): Promise<InternalAuthResult> {
  const received = String(req.headers.get("x-nvx-internal-secret") || "").trim();
  if (!received) return { ok: false, status: 403, message: "Forbidden" };

  let expected = "";
  try {
    expected = String((await resolveExpectedSecret()) || "").trim();
  } catch {
    return { ok: false, status: 500, message: "Server configuration error" };
  }

  if (!expected) return { ok: false, status: 500, message: "Server configuration error" };
  if (!(await secretMatches(received, expected))) {
    return { ok: false, status: 403, message: "Forbidden" };
  }
  return { ok: true };
}
