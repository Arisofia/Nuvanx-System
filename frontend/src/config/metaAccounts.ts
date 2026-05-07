export const META_ACCOUNT_IDS = ['act_9523446201036125', 'act_4172099716404860'] as const

export function resolveMetaAccountIds(accountIds: readonly unknown[] = []) {
  const normalized = [...META_ACCOUNT_IDS, ...accountIds]
    .map((accountId) => String(accountId ?? '').trim())
    .filter(Boolean)

  return Array.from(new Set(normalized))
}

export function formatMetaAccountIds(accountIds?: readonly unknown[]) {
  return resolveMetaAccountIds(accountIds).join(', ')
}
