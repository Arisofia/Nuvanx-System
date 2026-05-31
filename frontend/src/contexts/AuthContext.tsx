import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient'

export interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  getSession: () => Promise<{ session: Session | null; error: Error | null }>
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return undefined
    }

    // Load initial session
    supabase.auth.getSession().then(({ data, error }) => {
      if (!error && data?.session?.user) {
        setUser(data.session.user)
      }
      setLoading(false)
    })

    // Keep user in sync with any auth change (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase no está configurado. Revisa las variables públicas de entorno del frontend.')
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    setUser(data.user)
  }

  const signOut = async () => {
    if (isSupabaseConfigured) {
      await supabase.auth.signOut()
    }
    setUser(null)
  }

  const getSession = async () => {
    if (!isSupabaseConfigured) {
      return { session: null, error: new Error('Supabase no está configurado.') }
    }

    const { data, error } = await supabase.auth.getSession()
    return { session: data?.session || null, error }
  }

  const value = useMemo(
    () => ({ user, isAuthenticated: !!user, loading, signIn, signOut, getSession }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
