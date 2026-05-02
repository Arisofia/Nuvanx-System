import { createContext, useEffect, useMemo, useState, ReactNode } from 'react'
import { supabase } from '../lib/supabaseClient'

export interface AuthContextType {
  user: any | null
  isAuthenticated: boolean
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  getSession: () => Promise<{ session: any | null; error: any }>
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
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
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    setUser(data.user)
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
  }

  const getSession = async () => {
    const { data, error } = await supabase.auth.getSession()
    return { session: data?.session || null, error }
  }

  const value = useMemo(
    () => ({ user, isAuthenticated: !!user, loading, signIn, signOut, getSession }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
