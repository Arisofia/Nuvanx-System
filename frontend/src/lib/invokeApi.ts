// frontend/src/lib/invokeApi.ts
import { supabase } from './supabaseClient'

export async function invokeApi<T>(functionName: string, body?: any): Promise<T> {
  // Prefer MCP key when available (for protected admin routes), fall back to anon
  const authToken =
    import.meta.env.VITE_MCP_API_KEY ||
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY;

  const { data, error } = await supabase.functions.invoke(functionName, {
    body: body || {},
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
  });

  if (error) {
    console.error(`Error invoking ${functionName}:`, error);
    throw new Error(error.message || `Error in ${functionName}`);
  }

  return data as T;
}
