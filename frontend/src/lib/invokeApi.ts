// frontend/src/lib/invokeApi.ts
import { supabase } from './supabaseClient'

export async function invokeApi<T>(functionName: string, body?: any): Promise<T> {
  const { data, error } = await supabase.functions.invoke(functionName, {
    body: body || {},
    headers: {
      'Authorization': `Bearer ${import.meta.env.VITE_MCP_API_KEY}`
    }
  });

  if (error) {
    console.error(`Error invoking ${functionName}:`, error);
    throw new Error(error.message || `Error in ${functionName}`);
  }

  // Devolvemos la data directamente para que componentes como useLeads.ts
  // puedan acceder a resp.leads sin errores de TypeScript.
  return data as T;
}
