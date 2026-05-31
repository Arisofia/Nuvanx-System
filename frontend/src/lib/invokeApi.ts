// frontend/src/lib/invokeApi.ts
import { supabase } from './supabaseClient';

/**
 * Calls a Supabase Edge Function through the Vercel proxy.
 * Automatically uses the current user's Supabase session JWT.
 *
 * This is the secure way — never expose MCP_API_KEY or service role keys to the browser.
 */
export async function invokeApi<T>(functionName: string, body?: any): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  if (!accessToken) {
    throw new Error('No active Supabase session. User must be logged in to call protected functions.');
  }

  const response = await fetch(`/api/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorBody = await response.json();
      errorMessage = errorBody?.message || errorBody?.error || errorMessage;
    } catch {
      // ignore json parse error
    }
    throw new Error(errorMessage);
  }

  return (await response.json()) as T;
}
