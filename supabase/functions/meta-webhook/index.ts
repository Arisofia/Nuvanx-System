/// <reference lib="deno.ns" />

/**
 * Legacy Meta webhook compatibility endpoint.
 *
 * The canonical Meta webhook implementation lives at /functions/v1/api/webhooks/meta,
 * where the raw request signature is validated with META_APP_SECRET, the Meta
 * integration is resolved by page_id, and lead/CAPI processing is centralized.
 *
 * This function intentionally contains no ingestion logic. It preserves the old
 * /functions/v1/meta-webhook callback while forwarding only the minimum request
 * data needed by the canonical handler.
 */

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const CANONICAL_META_WEBHOOK_PATH = '/functions/v1/api/webhooks/meta';
const FORWARDED_REQUEST_HEADERS = ['content-type', 'x-hub-signature-256', 'origin'] as const;

function buildCanonicalUrl(requestUrl: string): URL {
  const incoming = new URL(requestUrl);
  const target = new URL(`${SUPABASE_URL}${CANONICAL_META_WEBHOOK_PATH}`);
  target.search = incoming.search;
  return target;
}

function buildForwardHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

Deno.serve(async (request: Request) => {
  if (!SUPABASE_URL) {
    return new Response('Server configuration error', { status: 500 });
  }

  if (!['GET', 'POST', 'OPTIONS'].includes(request.method)) {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const target = buildCanonicalUrl(request.url);
    const body = request.method === 'POST' ? await request.arrayBuffer() : undefined;
    const response = await fetch(target, {
      method: request.method,
      headers: buildForwardHeaders(request),
      body,
      redirect: 'manual',
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    console.error('[meta-webhook-compat] canonical proxy failed', error);
    return new Response('Webhook unavailable', { status: 502 });
  }
});
