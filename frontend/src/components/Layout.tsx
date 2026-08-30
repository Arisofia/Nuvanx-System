import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import {
  Activity,
  BarChart2,
  Bot,
  DollarSign,
  FileBarChart2,
  GitMerge,
  Globe,
  Home,
  LogOut,
  Megaphone,
  Menu,
  Plug,
  Users,
} from 'lucide-react'
import { Button } from './ui/button'
import logo from '../assets/logo.png'
import { useAuth } from '../contexts/useAuth'

const primaryNavItems = [
  { label: 'Centro', href: '/dashboard', icon: Home },
  { label: 'Pacientes', href: '/crm', icon: Users },
  { label: 'Agenda', href: '/live', icon: Activity },
  { label: 'Adquisición', href: '/marketing', icon: Megaphone },
  { label: 'Finanzas', href: '/financials', icon: DollarSign },
  { label: 'Inteligencia', href: '/intelligence', icon: BarChart2 },
  { label: 'Analítica', href: '/reports', icon: FileBarChart2 },
  { label: 'Integraciones', href: '/integrations', icon: Plug },
]

const systemNavItems = [
  { label: 'SEO & IA', href: '/seo', icon: Globe },
  { label: 'Trazabilidad', href: '/traceability', icon: GitMerge },
  { label: 'Auditoría leads', href: '/reports/lead-audit', icon: FileBarChart2 },
  { label: 'Asistente IA', href: '/ai', icon: Bot },
]

function NavigationItem({
  item,
  location,
  sidebarOpen,
}: Readonly<{
  item: { label: string; href: string; icon: typeof Home }
  location: string
  sidebarOpen: boolean
}>) {
  const active = location === item.href
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      className={`flex items-center gap-4 px-5 py-3.5 rounded-2xl transition-all duration-300 group relative ${
        active
          ? 'bg-[#84643B] text-white shadow-[0_10px_20px_rgba(132,100,59,0.15)]'
          : 'text-[#8E8680] hover:text-[#84643B] hover:bg-[#84643B]/5'
      }`}
    >
      <item.icon className={`w-4 h-4 transition-all duration-300 ${
        active ? 'text-white scale-110' : 'text-[#B08B5A]/60 group-hover:scale-110 group-hover:text-[#84643B]'
      }`} />
      {sidebarOpen && <span className="text-[11px] font-bold uppercase tracking-widest">{item.label}</span>}
      {active && <div className="absolute right-3 w-1 h-1 rounded-full bg-white/40" />}
    </Link>
  )
}

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [location] = useLocation()
  const { signOut } = useAuth()

  return (
    <div className="flex h-screen bg-[#FAF7F2] text-foreground font-sans">
      <aside className={`${sidebarOpen ? 'w-72' : 'w-24'} bg-white border-r border-[#E5D5C5]/40 transition-all duration-500 flex flex-col shadow-[10px_0_40px_rgba(176,139,90,0.02)] z-30`}>
        <div className="p-10 flex flex-col items-center relative">
          <div className="absolute top-8 right-6">
            <Button variant="ghost" size="sm" className="hover:bg-[#B08B5A]/5 rounded-full h-8 w-8 p-0 transition-colors" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label={sidebarOpen ? 'Contraer navegación' : 'Expandir navegación'}>
              <Menu className="w-4 h-4 text-[#B08B5A]" />
            </Button>
          </div>

          {sidebarOpen ? (
            <div className="flex flex-col items-center text-center mt-4">
              <div className="bg-[#FAF7F2] p-4 rounded-[2rem] shadow-sm mb-6 border border-[#E5D5C5]/30">
                <img src={logo} alt="NUVANX" className="h-14 w-auto" />
              </div>
              <p className="text-[9px] uppercase tracking-[0.4em] text-[#B08B5A] font-black">Control Centre</p>
              <p className="mt-2 text-[10px] text-[#8E8680]">Clínica · Growth · Pacientes</p>
              <div className="h-[2px] w-8 bg-gradient-to-r from-transparent via-[#B08B5A]/30 to-transparent mt-5" />
            </div>
          ) : (
            <div className="mt-8 bg-[#FAF7F2] p-3 rounded-2xl border border-[#E5D5C5]/30 shadow-sm">
              <img src={logo} alt="NUVANX" className="h-6 w-auto" />
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-6 custom-scrollbar" aria-label="Navegación principal">
          {sidebarOpen && <p className="px-5 pb-2 text-[9px] font-black uppercase tracking-[0.18em] text-[#B8ADA4]">Operación</p>}
          <div className="space-y-2">
            {primaryNavItems.map((item) => <NavigationItem key={item.href} item={item} location={location} sidebarOpen={sidebarOpen} />)}
          </div>

          <div className="my-5 h-px bg-[#E5D5C5]/40" />
          {sidebarOpen && <p className="px-5 pb-2 text-[9px] font-black uppercase tracking-[0.18em] text-[#B8ADA4]">Sistema</p>}
          <div className="space-y-2">
            {systemNavItems.map((item) => <NavigationItem key={item.href} item={item} location={location} sidebarOpen={sidebarOpen} />)}
          </div>
        </nav>

        <div className="p-8 border-t border-[#E5D5C5]/30">
          <Button
            variant="ghost"
            size="sm"
            className="w-full gap-4 justify-start px-5 py-7 rounded-2xl hover:bg-red-50 hover:text-red-500 transition-all duration-300 text-[#8E8680] group"
            onClick={async () => {
              try {
                await signOut()
              } catch (error) {
                console.error('Error al cerrar sesión:', error)
              }
            }}
          >
            <LogOut className="w-4 h-4" />
            {sidebarOpen && <span className="text-sm font-medium">Cerrar sesión</span>}
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-transparent">
        <div className="max-w-[1700px] mx-auto p-6 lg:p-10">{children}</div>
      </main>
    </div>
  )
}
