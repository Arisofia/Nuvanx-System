declare const Deno: any;

const CANONICAL_APP_SECRET = 'META_CANONICAL_APP_SECRET';
const LEGACY_APP_SECRET_ALIASES = ['META_REPORTING_APP_SECRET', 'META_APP_SECRET'] as const;

/**
 * Canonical meta_ads runtimes have one App Secret authority in Production.
 *
 * The governed deploy owner publishes META_CANONICAL_APP_SECRET from the
 * protected GitHub Production secret. Canonical-only Edge entrypoints call
 * this boundary before dynamically loading their implementation so historical
 * aliases cannot silently rescue a stale/missing canonical secret.
 */
export function enforceCanonicalMetaRuntimeBoundary(): void {
  const canonical = String(Deno.env.get(CANONICAL_APP_SECRET) || '').trim();
  if (!canonical) {
    throw new Error(`${CANONICAL_APP_SECRET} is required for canonical meta_ads runtime`);
  }

  for (const alias of LEGACY_APP_SECRET_ALIASES) {
    Deno.env.delete(alias);
  }
}
