// Nuvanx API Edge Function — v7
// Routes all frontend API calls. Supabase strips /functions/v1 so the path
// starts at /api/...

declare const Deno: any;
// @ts-ignore — resolved at runtime via supabase/functions/import_map.json
import { createClient } from 'supabase';
import { normalizePhoneToE164 } from '../../shared/phone.ts';
import { mapLeadPayloadToCapiEvent } from '../../shared/capi.ts';
