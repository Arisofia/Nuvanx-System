/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function normalizedSecret(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

/**
 * Build the App Secret proof authority for a Meta request.
 *
 * Default calls are canonical `meta_ads` calls. They MUST have exactly one
 * configured canonical App Secret; a legacy secret and a bare-token request
 * are not valid recovery candidates. Legacy `service='meta'` callers remain
 * possible only by passing an explicit override selected by the service owner.
 *
 * @param {string | null | undefined} canonicalSecret
 * @param {string | null | undefined} legacySecret Retained only for call-site
 *   compatibility; it is never an implicit canonical candidate.
 * @param {string | null | undefined} appSecretOverride
 * @returns {Array<string | null>}
 */
export function buildMetaAppSecretCandidates(canonicalSecret, legacySecret, appSecretOverride) {
  void legacySecret;
  if (appSecretOverride !== undefined) return [normalizedSecret(appSecretOverride)];

  const canonical = normalizedSecret(canonicalSecret);
  if (!canonical) {
    throw new Error('Canonical Meta App Secret is required; implicit legacy or bare-token fallback is forbidden');
  }
  return [canonical];
}

/**
 * @param {any} body
 * @returns {boolean}
 */
export function isInvalidMetaAppSecretProof(body) {
  const message = String(body?.error?.message ?? body?.message ?? '').toLowerCase();
  return message.includes('appsecret_proof') || message.includes('app secret proof');
}

/**
 * @param {number} index
 * @param {Array<string | null>} candidates
 * @param {any} body
 * @returns {boolean}
 */
export function shouldRetryMetaAppSecretProof(index, candidates, body) {
  return index + 1 < candidates.length && isInvalidMetaAppSecretProof(body);
}
