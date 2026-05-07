import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import { Menu, X, LogOut, Home, Activity, Users, Megaphone, DollarSign, BarChart2, Plug, Sparkles, FileBarChart2, GitMerge } from 'lucide-react'
import { Button } from './ui/button'
import logo from '../assets/logo.png'

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

  return (
    <div className="flex h-screen bg-[#FAF7F2] text-foreground font-sans">
      <aside className={`${sidebarOpen ? 'w-64' : 'w-20'} bg-white border-r border-border/60 transition-all duration-300 flex flex-col shadow-[4px_0_24px_rgba(0,0,0,0.02)]`}>
        <div className="p-8 flex flex-col items-center">
          <div className="flex items-center justify-between w-full mb-6">
            <Button variant="ghost" size="sm" className="hover:bg-primary/5 rounded-full h-8 w-8 p-0" onClick={() => setSidebarOpen(!sidebarOpen)}>
              {sidebarOpen ? <Menu className="w-4 h-4 text-muted" /> : <Menu className="w-4 h-4 text-muted" />}
            </Button>
          </div>
          
          {sidebarOpen ? (
            <div className="flex flex-col items-center text-center">
              <img src={logo} alt="Nuvanx Logo" className="h-16 w-auto mb-4" />
              <p className="text-[10px] uppercase tracking-[0.3em] text-primary font-bold">Control Centre</p>
              <div className="h-[1px] w-6 bg-primary/20 mt-4" />
            </div>
          ) : (
            <img src={logo} alt="Logo" className="h-8 w-auto" />
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-4 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 group ${
                location === item.href 
                  ? 'bg-primary/10 text-primary font-semibold shadow-sm' 
                  : 'text-[#5C5550] hover:text-primary hover:bg-primary/5'
              }`}
            >
              <item.icon className={`w-4 h-4 transition-transform duration-300 group-hover:scale-110 ${
                location === item.href ? 'text-primary' : 'text-[#8E8680]/70'
              }`} />
              {sidebarOpen && <span className="text-sm tracking-wide">{item.label}</span>}
            </Link>
          ))}
        </nav>

        <div className="p-6 border-t border-border/40">
          <Button variant="ghost" size="sm" className="w-full gap-3 justify-start px-4 py-6 rounded-xl hover:bg-red-50 hover:text-red-500 transition-colors text-muted">
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
