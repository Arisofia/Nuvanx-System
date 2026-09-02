from pathlib import Path

api_path = Path('supabase/functions/api/index.ts')
api = api_path.read_text()

start = api.index('// ── Meta credential resolver')
select_start = api.index('function selectCanonicalMetaIntegration', start)

new_resolver = r'''// ── Meta credential resolver ──────────────────────────────────────────────────
async function resolveMetaIntegration(adminClient: any, userId: string, qAccountId: string) {
  const requesterClinicId = await resolveClinicId(adminClient, userId);
  let integrationsQuery = adminClient
    .from('integrations')
    .select('user_id, clinic_id, service, metadata, status, updated_at')
    .in('service', ['meta_ads', 'meta'])
    .eq('status', 'connected');

  integrationsQuery = requesterClinicId
    ? integrationsQuery.eq('clinic_id', requesterClinicId)
    : integrationsQuery.eq('user_id', userId).is('clinic_id', null);

  const { data: integrations, error } = await integrationsQuery;
  if (error) throw error;

  const connected = integrations ?? [];
  const requestedAccountIds = normalizeMetaAccountIds(qAccountId);
  const matchingRows = requestedAccountIds.length > 0
    ? connected.filter((row: any) => {
        const metadata = row?.metadata ?? {};
        const ids = normalizeMetaAccountIds(
          metadata.adAccountIds ?? metadata.ad_account_ids ?? metadata.adAccountId ?? metadata.ad_account_id ?? '',
        );
        return requestedAccountIds.some((id) => ids.includes(id));
      })
    : connected;

  return {
    integration: selectCanonicalMetaIntegration(matchingRows),
    requesterClinicId,
    requestedAccountIds,
  } as const;
}

async function resolveMetaCreds(adminClient: any, userId: string, qAccountId: string) {
  const { integration: intg, requesterClinicId, requestedAccountIds } = await resolveMetaIntegration(
    adminClient,
    userId,
    qAccountId,
  );
  if (!intg) {
    return { notConnected: true, accessToken: '', adAccountIds: [] as string[], adAccountId: '', decryptionError: '' };
  }

  const integrationOwnerId = String(intg.user_id ?? '').trim();
  if (!integrationOwnerId) {
    return { notConnected: true, accessToken: '', adAccountIds: [] as string[], adAccountId: '', decryptionError: '' };
  }

  const credentialService = intg.service === 'meta_ads' ? 'meta_ads' : 'meta';
  let credentialQuery = adminClient.from('credentials')
    .select('encrypted_key')
    .eq('user_id', integrationOwnerId)
    .eq('service', credentialService);
  credentialQuery = requesterClinicId
    ? credentialQuery.eq('clinic_id', requesterClinicId)
    : credentialQuery.is('clinic_id', null);

  const { data: credRow, error: credentialError } = await credentialQuery.maybeSingle();
  if (credentialError) throw credentialError;
  if (!credRow?.encrypted_key) {
    return { notConnected: true, accessToken: '', adAccountIds: [] as string[], adAccountId: '', decryptionError: '' };
  }

  let accessToken = '';
  let decryptionError = '';
  try {
    accessToken = await decryptCred(credRow.encrypted_key);
  } catch (err: any) {
    decryptionError = err?.message ?? 'Failed to decrypt Meta credential';
  }

  const metadata = intg.metadata ?? {};
  const metadataRawAccountIds = metadata.adAccountIds ?? metadata.ad_account_ids ?? metadata.adAccountId ?? metadata.ad_account_id ?? '';
  const metadataAccountIds = normalizeMetaAccountIds(metadataRawAccountIds);
  const adAccountIds = requestedAccountIds.length > 0 ? requestedAccountIds : metadataAccountIds;

  let pixelId = metadata.pixelId ?? metadata.pixel_id ?? '';
  const activeAccountId = adAccountIds[0] ?? '';
  const mappingStr = Deno.env.get('META_PIXEL_MAPPING');
  if (mappingStr) {
    try {
      const mapping = JSON.parse(mappingStr);
      if (mapping[activeAccountId]) pixelId = mapping[activeAccountId];
    } catch (e) {
      console.error('[CAPI-ROUTING] Error parsing META_PIXEL_MAPPING:', e);
    }
  }

  if (!pixelId && !mappingStr) {
    console.warn(`[CAPI-ROUTING] No pixel mapping found for account ${activeAccountId}`);
  }

  console.log('[CAPI-ROUTING] Meta stack selected', {
    service: credentialService,
    accountId: activeAccountId,
    clinicScoped: Boolean(requesterClinicId),
    hasPixel: Boolean(pixelId),
  });

  return {
    notConnected: false,
    accessToken,
    adAccountIds,
    adAccountId: activeAccountId,
    pixelId,
    pageId: metadata.pageId ?? metadata.page_id ?? '',
    igId: metadata.igBusinessAccountId ?? metadata.ig_business_account_id ?? '',
    credentialService,
    decryptionError,
  } as const;
}

'''

api = api[:start] + new_resolver + api[select_start:]

old_organic_resolver = r'''  // Resolve pageId from integrations.metadata
  const { data: integrations } = await adminClient.from('integrations')
    .select('service, metadata, status, updated_at')
    .eq('user_id', userId)
    .in('service', ['meta_ads', 'meta'])
    .eq('status', 'connected');

  const integ = selectCanonicalMetaIntegration(integrations ?? []);
'''
new_organic_resolver = r'''  const { integration: integ, requesterClinicId } = await resolveMetaIntegration(adminClient, userId, '');
'''
if old_organic_resolver not in api:
    raise SystemExit('organic resolver block not found')
api = api.replace(old_organic_resolver, new_organic_resolver, 1)

old_ig_resolver = r'''  const { data: integrations } = await adminClient.from('integrations')
    .select('service, metadata, status, updated_at')
    .eq('user_id', userId)
    .in('service', ['meta_ads', 'meta'])
    .eq('status', 'connected');

  const integ = selectCanonicalMetaIntegration(integrations ?? []);
'''
new_ig_resolver = r'''  const { integration: integ, requesterClinicId } = await resolveMetaIntegration(adminClient, userId, '');
'''
if old_ig_resolver not in api:
    raise SystemExit('ig resolver block not found')
api = api.replace(old_ig_resolver, new_ig_resolver, 1)

# Clinic-scope Meta Organic persisted reads.
old = r'''    let query = adminClient
      .from('meta_post_performance')
      .select('post_id, created_time, message, status_type, permalink_url, impressions, reach, engaged_users, reactions, comments, shares, video_views, is_video')
      .eq('user_id', userId)
      .eq('page_id', pageId)
      .order('created_time', { ascending: false })
      .limit(limit);
'''
new = r'''    let query = adminClient
      .from('meta_post_performance')
      .select('post_id, created_time, message, status_type, permalink_url, impressions, reach, engaged_users, reactions, comments, shares, video_views, is_video')
      .eq('page_id', pageId)
      .order('created_time', { ascending: false })
      .limit(limit);
    query = applyClinicOrUserScope(query, requesterClinicId, userId);
'''
if old not in api: raise SystemExit('organic posts query not found')
api = api.replace(old, new, 1)

old = r'''  const { data: rows, error } = await adminClient.from('meta_organic_daily')
    .select('date, impressions, reach, engagements, video_views, page_views, reactions')
    .eq('user_id', userId)
    .eq('page_id', pageId)
    .gte('date', sinceStr)
    .lte('date', until)
    .order('date', { ascending: true });
'''
new = r'''  let query = adminClient.from('meta_organic_daily')
    .select('date, impressions, reach, engagements, video_views, page_views, reactions')
    .eq('page_id', pageId)
    .gte('date', sinceStr)
    .lte('date', until)
    .order('date', { ascending: true });
  query = applyClinicOrUserScope(query, requesterClinicId, userId);
  const { data: rows, error } = await query;
'''
if old not in api: raise SystemExit('organic daily query not found')
api = api.replace(old, new, 1)

# Clinic-scope Instagram discovery and persisted reads.
old = r'''    const { data: igDiscover } = await adminClient.from('meta_ig_account_daily')
      .select('ig_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    igId = igDiscover?.ig_id ?? null;
'''
new = r'''    let igDiscoverQuery = adminClient.from('meta_ig_account_daily')
      .select('ig_id')
      .limit(1);
    igDiscoverQuery = applyClinicOrUserScope(igDiscoverQuery, requesterClinicId, userId);
    const { data: igDiscover } = await igDiscoverQuery.maybeSingle();
    igId = igDiscover?.ig_id ?? null;
'''
if old not in api: raise SystemExit('ig discovery query not found')
api = api.replace(old, new, 1)

old = r'''    let query = adminClient
      .from('meta_ig_media_performance')
      .select('media_id, media_type, media_product_type, caption, permalink, timestamp, reach, views, likes, comments, shares, saved, total_interactions')
      .eq('user_id', userId)
      .eq('ig_id', igId)
      .order('timestamp', { ascending: false })
      .limit(limit);
'''
new = r'''    let query = adminClient
      .from('meta_ig_media_performance')
      .select('media_id, media_type, media_product_type, caption, permalink, timestamp, reach, views, likes, comments, shares, saved, total_interactions')
      .eq('ig_id', igId)
      .order('timestamp', { ascending: false })
      .limit(limit);
    query = applyClinicOrUserScope(query, requesterClinicId, userId);
'''
if old not in api: raise SystemExit('ig posts query not found')
api = api.replace(old, new, 1)

old = r'''  const { data: rows, error } = await adminClient.from('meta_ig_account_daily')
    .select('date, reach, follower_count_delta, profile_views, accounts_engaged, total_interactions, website_clicks, views')
    .eq('user_id', userId)
    .eq('ig_id', igId)
    .gte('date', sinceStr)
    .lte('date', until)
    .order('date', { ascending: true });
'''
new = r'''  let query = adminClient.from('meta_ig_account_daily')
    .select('date, reach, follower_count_delta, profile_views, accounts_engaged, total_interactions, website_clicks, views')
    .eq('ig_id', igId)
    .gte('date', sinceStr)
    .lte('date', until)
    .order('date', { ascending: true });
  query = applyClinicOrUserScope(query, requesterClinicId, userId);
  const { data: rows, error } = await query;
'''
if old not in api: raise SystemExit('ig daily query not found')
api = api.replace(old, new, 1)

api_path.write_text(api)
print('Meta tenant-safe resolver and clinic-scoped social reads applied.')
