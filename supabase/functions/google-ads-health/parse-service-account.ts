type FailureKind = "request" | "configuration" | "oauth" | "provider" | "validation" | "persistence";

export class HealthFailure extends Error {
  kind: FailureKind;
  status: number;

  constructor(kind: FailureKind, status: number, message: string) {
    super(message);
    this.name = "HealthFailure";
    this.kind = kind;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseServiceAccount(raw: string): Record<string, any> {
  if (!raw) throw new HealthFailure("configuration", 500, "Google Ads service account not configured");
  const candidates: string[] = [];
  const add = (value: string) => {
    const clean = String(value || "").trim();
    if (clean && !candidates.includes(clean)) candidates.push(clean);
  };
  add(raw);
  if (raw.startsWith("GOOGLE_ADS_SERVICE_ACCOUNT=")) add(raw.slice("GOOGLE_ADS_SERVICE_ACCOUNT=".length) || "");
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) add(raw.slice(1, -1));
  if (raw.startsWith("base64:") || raw.startsWith("b64:")) add(raw.split(":", 2)[1] || "");
  if (raw.includes('\\"')) add(raw.replaceAll('\\"', '"'));

  for (const candidate of [...candidates]) {
    if ((candidate.startsWith('"') && candidate.endsWith('"')) || (candidate.startsWith("'") && candidate.endsWith("'"))) {
      add(candidate.slice(1, -1));
    }
    if (candidate.includes('\\"')) {
      add(candidate.replaceAll('\\"', '"'));
    }
  }

  for (const candidate of [...candidates]) {
    const compact = candidate.replace(/\s+/g, "");
    const padded = compact + "=".repeat((4 - (compact.length % 4)) % 4);
    for (const value of [padded, padded.replaceAll("-", "+").replaceAll("_", "/")]) {
      try {
        add(atob(value));
      } catch {
        // Not base64; continue.
      }
    }
  }

  for (const candidate of candidates) {
    try {
      let parsed: any = JSON.parse(candidate);
      if (typeof parsed === "string") parsed = JSON.parse(parsed);
      if (isRecord(parsed) && parsed.client_email && parsed.private_key) return parsed;
    } catch {
      // Try next representation.
    }
  }
  throw new HealthFailure("configuration", 500, "Google Ads service account is malformed");
}
