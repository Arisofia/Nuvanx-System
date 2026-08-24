/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function normalizedSecret(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

/**
 * @param {string | null | undefined} canonicalSecret
 * @param {string | null | undefined} legacySecret
 * @param {string | null | undefined} appSecretOverride
 * @returns {Array<string | null>}
 */
export function buildMetaAppSecretCandidates(canonicalSecret, legacySecret, appSecretOverride) {
  if (appSecretOverride !== undefined) return [normalizedSecret(appSecretOverride)];
  const configured = [canonicalSecret, legacySecret]
    .map(normalizedSecret)
    .filter(Boolean);
  return [...new Set(configured), null];
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
