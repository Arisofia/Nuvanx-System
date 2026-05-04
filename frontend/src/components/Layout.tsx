import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import { Menu, X, LogOut, Home, Activity, Users, Megaphone, DollarSign, BarChart2, BookOpen, Plug, Sparkles, FileBarChart2 } from 'lucide-react'
import { Button } from './ui/button'

const navItems = [
  { label: 'Dashboard', href: '/dashboard', icon: Home },
  { label: 'Live', href: '/live', icon: Activity },
  { label: 'CRM', href: '/crm', icon: Users },
  { label: 'Marketing', href: '/marketing', icon: Megaphone },
  { label: 'Financials', href: '/financials', icon: DollarSign },
  { label: 'Intelligence', href: '/intelligence', icon: BarChart2 },
  { label: 'Playbooks', href: '/playbooks', icon: BookOpen },
  { label: 'Reports', href: '/reports', icon: FileBarChart2 },
  { label: 'Integrations', href: '/integrations', icon: Plug },
  { label: 'AI', href: '/ai', icon: Sparkles },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [location] = useLocation()

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className={`${sidebarOpen ? 'w-64' : 'w-20'} bg-card border-r border-border transition-all duration-300 flex flex-col`}>
        <div className="p-4 border-b border-border flex items-center justify-between">
          {sidebarOpen && <h2 className="font-bold text-lg">Nuvanx</h2>}
          <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                location === item.href ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'
              }`}
            >
              <item.icon className="w-5 h-5" />
              {sidebarOpen && <span className="text-sm">{item.label}</span>}
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-border">
          <Button variant="outline" size="sm" className="w-full gap-2">
            <LogOut className="w-4 h-4" />
            {sidebarOpen && 'Logout'}
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-slate-950 text-white">
        <div className="p-8">{children}</div>
      </main>
    </div>
  )
}
