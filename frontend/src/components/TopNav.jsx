import { useLocation } from 'react-router-dom';
import { Bell, Search } from 'lucide-react';

const pageTitles = {
  '/dashboard': 'Dashboard',
  '/live': 'Operational Snapshot',
  '/crm': 'CRM & Lead Pipeline',
  '/operativo': 'Playbooks',
  '/integrations': 'Integrations',
  '/ai': 'AI Layer',
};

export default function TopNav() {
  const { pathname } = useLocation();
  const title = pageTitles[pathname] || 'Nuvanx';

  return (
    <header className="h-16 bg-dark-800 border-b border-dark-600 flex items-center justify-between px-6 shrink-0">
      <div>
        <h1 className="text-lg font-semibold text-white">{title}</h1>
        <p className="text-xs text-gray-500">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative hidden md:block">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search…"
            aria-label="Search"
            className="bg-dark-700 border border-dark-600 text-sm text-gray-300 placeholder-gray-500 rounded-lg pl-9 pr-4 py-2 w-48 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500/50 transition"
          />
        </div>
        <button className="relative p-2 rounded-lg text-gray-400 hover:text-white hover:bg-dark-700 transition-colors">
          <Bell size={18} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-brand-500 rounded-full" />
        </button>
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-sm font-bold">
          N
        </div>
      </div>
    </header>
  );
}
