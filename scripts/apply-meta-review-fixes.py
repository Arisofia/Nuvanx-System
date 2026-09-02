from pathlib import Path

path = Path('supabase/functions/api/index.ts')
api = path.read_text()

old = """async function resolveClinicId(adminClient: any, userId: string): Promise<string | null> {
  const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', userId).single();
  return usr?.clinic_id ?? null;
}
"""
new = """async function resolveClinicId(adminClient: any, userId: string): Promise<string | null> {
  const { data: usr, error } = await adminClient.from('users').select('clinic_id').eq('id', userId).maybeSingle();
  if (error) throw error;
  return usr?.clinic_id ?? null;
}
"""
if old not in api:
    raise SystemExit('resolveClinicId block not found')
api = api.replace(old, new, 1)

old = """  if (!intg) {
    return { notConnected: true, accessToken: '', adAccountIds: [] as string[], adAccountId: '', decryptionError: '' };
  }

  const integrationOwnerId = String(intg.user_id ?? '').trim();
  if (!integrationOwnerId) {
    return { notConnected: true, accessToken: '', adAccountIds: [] as string[], adAccountId: '', decryptionError: '' };
  }

  const credentialService = intg.service === 'meta_ads' ? 'meta_ads' : 'meta';
"""
new = """  if (!intg) {
    return {
      notConnected: true,
      accessToken: '',
      adAccountIds: [] as string[],
      adAccountId: '',
      decryptionError: '',
      integrationOwnerId: '',
      integrationService: '',
    };
  }

  const integrationService = intg.service === 'meta_ads' ? 'meta_ads' : 'meta';
  const integrationOwnerId = String(intg.user_id ?? '').trim();
  if (!integrationOwnerId) {
    return {
      notConnected: true,
      accessToken: '',
      adAccountIds: [] as string[],
      adAccountId: '',
      decryptionError: '',
      integrationOwnerId: '',
      integrationService,
    };
  }

  const credentialService = integrationService;
"""
if old not in api:
    raise SystemExit('resolver head block not found')
api = api.replace(old, new, 1)

old = """  if (!credRow?.encrypted_key) {
    return { notConnected: true, accessToken: '', adAccountIds: [] as string[], adAccountId: '', decryptionError: '' };
  }
"""
new = """  if (!credRow?.encrypted_key) {
    return {
      notConnected: true,
      accessToken: '',
      adAccountIds: [] as string[],
      adAccountId: '',
      decryptionError: '',
      integrationOwnerId,
      integrationService,
    };
  }
"""
if old not in api:
    raise SystemExit('missing credential block not found')
api = api.replace(old, new, 1)

old = """    credentialService,
    decryptionError,
  } as const;
}
"""
new = """    credentialService,
    integrationOwnerId,
    integrationService,
    decryptionError,
  } as const;
}
"""
if old not in api:
    raise SystemExit('resolver return tail not found')
api = api.replace(old, new, 1)

old = """    if (service === 'meta') {
      const creds = await resolveMetaCreds(adminClient, userId, body?.adAccountId ?? '');
      const validation = validateMetaCredentialResult(creds);
      if (!validation.ok) {
        await updateIntegrationStatus(adminClient, userId, 'meta', 'error', validation.message);
        return sendJson({ success: false, service, status: 'error', message: validation.message }, validation.statusCode);
      }
      try {
        const me = await metaFetch('/me', { fields: 'id,name' }, creds.accessToken);
        await updateIntegrationStatus(adminClient, userId, 'meta', 'connected', null);
        return sendJson({ success: true, service, status: 'connected', metadata: { accountName: me.name } });
      } catch (e: any) {
        await updateIntegrationStatus(adminClient, userId, 'meta', 'error', e.message);
        return sendJson({ success: false, service, status: 'error', message: e.message }, 502);
      }
    }
"""
new = """    if (service === 'meta') {
      const creds = await resolveMetaCreds(adminClient, userId, body?.adAccountId ?? '');
      const validation = validateMetaCredentialResult(creds);
      const integrationOwnerId = creds.integrationOwnerId ?? '';
      const integrationService = creds.integrationService ?? '';
      if (!validation.ok) {
        if (integrationOwnerId && integrationService) {
          await updateIntegrationStatus(adminClient, integrationOwnerId, integrationService, 'error', validation.message);
        }
        return sendJson({ success: false, service, status: 'error', message: validation.message }, validation.statusCode);
      }
      try {
        const me = await metaFetch('/me', { fields: 'id,name' }, creds.accessToken);
        await updateIntegrationStatus(adminClient, integrationOwnerId, integrationService, 'connected', null);
        return sendJson({ success: true, service, status: 'connected', metadata: { accountName: me.name } });
      } catch (e: any) {
        await updateIntegrationStatus(adminClient, integrationOwnerId, integrationService, 'error', e.message);
        return sendJson({ success: false, service, status: 'error', message: e.message }, 502);
      }
    }
"""
if old not in api:
    raise SystemExit('meta integration test block not found')
api = api.replace(old, new, 1)

path.write_text(api)
print('Meta review hardening applied')
