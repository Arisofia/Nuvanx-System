import { useState, type FormEvent, type ChangeEvent } from 'react'
import { useLocation } from 'wouter'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { supabase, supabaseUrl, supabaseKey } from '../lib/supabaseClient'

export default function Login() {
  const [, setLocation] = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey)

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setMessage('')
    if (!email.trim() || !password.trim()) {
      setMessage('Please enter both email and password.')
      return
    }

    setLoading(true)
    if (!isSupabaseConfigured) {
      setMessage('Supabase not configured. Redirecting to demo mode...')
      setTimeout(() => {
        setLoading(false)
        setLocation('/dashboard')
      }, 1000)
      return
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)

    if (error) {
      setMessage(error.message || 'Login failed. Please try again.')
      return
    }

    setLocation('/dashboard')
  }

  const handleDemoLogin = () => {
    setLocation('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Nuvanx System</CardTitle>
          <p className="text-sm text-slate-600 mt-2">Revenue Intelligence Platform</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Password</label>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                className="mt-1"
              />
            </div>
            {message && <p className="text-sm text-red-500">{message}</p>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Logging in...' : 'Login'}
            </Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-slate-500">or</span>
            </div>
          </div>

          <Button variant="outline" className="w-full" onClick={handleDemoLogin}>
            Enter Demo Mode
          </Button>

          <p className="text-xs text-slate-500 text-center">
            {isSupabaseConfigured
              ? 'Use your Supabase account to sign in.'
              : 'Demo mode provides access to sample data and features.'}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
