declare const Deno: any;

const CANONICAL_ENV_NAME = 'META_CANONICAL_APP_SECRET';
const RETIRED_ENV_ALIASES = ['META_REPORTING_APP_SECRET', 'META_APP_SECRET'] as const;

/**
 * Canonical meta_ads runtimes have one App Secret authority in Production.
 *
 * The governed deploy owner publishes META_CANONICAL_APP_SECRET from the
 * protected GitHub Production secret. Canonical-only Edge entrypoints call
 * this boundary before dynamically loading their implementation so historical
 * aliases cannot silently rescue a stale/missing canonical secret.
 */
export function enforceCanonicalMetaRuntimeBoundary(): void {
  const canonical = String(Deno.env.get(CANONICAL_ENV_NAME) || '').trim();
  if (!canonical) {
    throw new Error(`${CANONICAL_ENV_NAME} is required for canonical meta_ads runtime`);
  }

  for (const alias of RETIRED_ENV_ALIASES) {
    Deno.env.delete(alias);
  }
}
