import { useState, type FormEvent, type ChangeEvent } from 'react'
import { useLocation } from 'wouter'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const [, setLocation] = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setMessage('')
    if (!email.trim() || !password.trim()) {
      setMessage('Please enter both email and password.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)

    if (error) {
      setMessage(error.message || 'Login failed. Please try again.')
      return
    }

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

          <p className="text-xs text-slate-500 text-center">
            Use your Supabase account to sign in.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
