import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = (event) => {
    event.preventDefault()
    setLoading(true)
    window.setTimeout(() => {
      setLoading(false)
      navigate('/dashboard')
    }, 800)
  }

  const handleDemo = () => {
    navigate('/dashboard')
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-700/80 bg-slate-900/95 p-8 shadow-2xl shadow-slate-950/40">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-semibold text-white">Nuvanx System</h1>
          <p className="mt-2 text-sm text-slate-400">Revenue Intelligence Platform</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-300">Email</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300">Password</label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <div className="relative my-6 text-center text-sm text-slate-500">
          <span className="bg-slate-900 px-3">or continue with</span>
        </div>
        <button
          type="button"
          onClick={handleDemo}
          className="w-full rounded-2xl border border-slate-700 bg-transparent px-4 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white"
        >
          Demo access
        </button>
        <p className="mt-4 text-center text-xs text-slate-500">
          Use the demo mode to explore the dashboard without credentials.
        </p>
      </div>
    </div>
  )
}
