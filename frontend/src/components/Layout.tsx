import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import { Menu, LogOut, Home, Activity, Users, Megaphone, DollarSign, BarChart2, Plug, Sparkles, FileBarChart2, GitMerge } from 'lucide-react'
import { Button } from './ui/button'
import logo from '../assets/logo.png'
import { useAuth } from '../contexts/useAuth'

const navItems = [
  { label: 'Dashboard', href: '/dashboard', icon: Home },
  { label: 'Trazabilidad', href: '/traceability', icon: GitMerge },
  { label: 'Reportes', href: '/reports', icon: FileBarChart2 },
  { label: 'Lead Audit', href: '/reports/lead-audit', icon: GitMerge },
  { label: 'Live', href: '/live', icon: Activity },
  { label: 'CRM', href: '/crm', icon: Users },
  { label: 'Marketing', href: '/marketing', icon: Megaphone },
  { label: 'Financials', href: '/financials', icon: DollarSign },
  { label: 'Intelligence', href: '/intelligence', icon: BarChart2 },
  { label: 'Integrations', href: '/integrations', icon: Plug },
  { label: 'AI', href: '/ai', icon: Sparkles },
]

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [location] = useLocation()
  const { signOut } = useAuth()

  return (
    <div className="flex h-screen bg-[#FAF7F2] text-foreground font-sans">
      <aside className={`${sidebarOpen ? 'w-72' : 'w-24'} bg-white border-r border-[#E5D5C5]/40 transition-all duration-500 flex flex-col shadow-[10px_0_40px_rgba(176,139,90,0.02)] z-30`}>
        <div className="p-10 flex flex-col items-center relative">
          <div className="absolute top-8 right-6">
            <Button variant="ghost" size="sm" className="hover:bg-[#B08B5A]/5 rounded-full h-8 w-8 p-0 transition-colors" onClick={() => setSidebarOpen(!sidebarOpen)}>
              <Menu className="w-4 h-4 text-[#B08B5A]" />
            </Button>
          </div>
          
          {sidebarOpen ? (
            <div className="flex flex-col items-center text-center mt-4">
              <div className="bg-[#FAF7F2] p-4 rounded-[2rem] shadow-sm mb-6 border border-[#E5D5C5]/30">
                <img src={logo} alt="Nuvanx Logo" className="h-14 w-auto" />
              </div>
              <p className="text-[9px] uppercase tracking-[0.4em] text-[#B08B5A] font-black">Control Centre</p>
              <div className="h-[2px] w-8 bg-gradient-to-r from-transparent via-[#B08B5A]/30 to-transparent mt-5" />
            </div>
          ) : (
            <div className="mt-8 bg-[#FAF7F2] p-3 rounded-2xl border border-[#E5D5C5]/30 shadow-sm">
              <img src={logo} alt="Logo" className="h-6 w-auto" />
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-8 px-6 space-y-2 custom-scrollbar">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-4 px-5 py-3.5 rounded-2xl transition-all duration-300 group relative ${
                location === item.href 
                  ? 'bg-[#84643B] text-white shadow-[0_10px_20px_rgba(132,100,59,0.15)]' 
                  : 'text-[#8E8680] hover:text-[#84643B] hover:bg-[#84643B]/5'
              }`}
            >
              <item.icon className={`w-4 h-4 transition-all duration-300 ${
                location === item.href ? 'text-white scale-110' : 'text-[#B08B5A]/60 group-hover:scale-110 group-hover:text-[#84643B]'
              }`} />
              {sidebarOpen && <span className="text-[11px] font-bold uppercase tracking-widest">{item.label}</span>}
              {location === item.href && (
                <div className="absolute right-3 w-1 h-1 rounded-full bg-white/40" />
              )}
            </Link>
          ))}
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
            {sidebarOpen && <span className="text-sm font-medium">Cerrar Sesión</span>}
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-transparent">
        <div className="max-w-[1600px] mx-auto p-10">{children}</div>
      </main>
    </div>
  )
}
