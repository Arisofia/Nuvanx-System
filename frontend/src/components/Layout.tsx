import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import { Menu, X, LogOut } from 'lucide-react'
import { Button } from './ui/button'

const navItems = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Live', href: '/live' },
  { label: 'CRM', href: '/crm' },
  { label: 'Marketing', href: '/marketing' },
  { label: 'Financials', href: '/financials' },
  { label: 'Intelligence', href: '/intelligence' },
  { label: 'Playbooks', href: '/playbooks' },
  { label: 'Integrations', href: '/integrations' },
  { label: 'AI', href: '/ai' },
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
              <div className="w-5 h-5 bg-slate-300 rounded" />
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
