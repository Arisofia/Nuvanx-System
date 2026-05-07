import { useState, type SyntheticEvent, type ChangeEvent } from 'react'
import { useLocation } from 'wouter'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { supabase } from '../lib/supabaseClient'
import logo from '../assets/logo.png'

export default function Login() {
  const [, setLocation] = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const handleLogin = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    setMessage('')
    if (!email.trim() || !password.trim()) {
      setMessage('Por favor, ingresa correo y contraseña.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)

    if (error) {
      setMessage(error.message || 'Error al acceder. Revisa tus credenciales.')
      return
    }

    setLocation('/dashboard')
  }

  return (
    <div className="min-h-screen bg-[#FAF7F2] flex items-center justify-center p-6 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px]" />

      <Card className="w-full max-w-md card-panel z-10">
        <CardHeader className="text-center pt-10 pb-6 border-none">
          <div className="flex flex-col items-center">
            <img src={logo} alt="Nuvanx Logo" className="h-24 w-auto mb-6" />
            <CardTitle className="text-3xl font-serif tracking-[0.2em] uppercase text-primary">Nuvanx</CardTitle>
            <p className="text-[10px] text-muted font-bold uppercase tracking-[0.3em] mt-2">Medicina Estética Láser</p>
          </div>
          
          <div className="diamond-separator my-8">
            <div className="diamond-separator-icon" />
          </div>
          
          <p className="text-sm font-medium text-muted tracking-wide italic">Plataforma Inteligente de Operación</p>
        </CardHeader>

        <CardContent className="px-10 pb-12 space-y-6">
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="login-email" className="text-[10px] font-bold text-muted uppercase tracking-widest ml-1">Correo Electrónico</label>
              <Input
                id="login-email"
                type="email"
                placeholder="tu@clinica.com"
                value={email}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                className="input-field"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="login-password" className="text-[10px] font-bold text-muted uppercase tracking-widest ml-1">Contraseña</label>
              <Input
                id="login-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                className="input-field"
              />
            </div>
            
            {message && (
              <div className="p-3 bg-red-50 rounded-xl border border-red-100 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                <p className="text-xs font-bold text-red-600">{message}</p>
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full btn-primary py-7 rounded-2xl">
              {loading ? 'Validando Acceso...' : 'Iniciar Sesión Premium'}
            </Button>
          </form>

          <div className="pt-6 space-y-3 text-center">
            <p className="text-[10px] text-muted font-bold uppercase tracking-tighter opacity-60">
              Usa tu cuenta corporativa para acceder.
            </p>
            <p className="text-[10px] text-muted font-medium">
              Soporte: <a href="mailto:support@nuvanx.com" className="text-primary font-bold hover:underline">support@nuvanx.com</a>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
