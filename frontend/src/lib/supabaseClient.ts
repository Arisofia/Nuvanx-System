import { createClient } from '@supabase/supabase-js'
import { supabaseKey, supabaseUrl } from './env'

export { supabaseKey, supabaseUrl }

export const supabase = createClient(supabaseUrl || '', supabaseKey || '')

// Backward-compatible re-export for legacy imports:
// import { invokeApi } from '../lib/supabaseClient'
export { invokeApi } from './invokeApi'
