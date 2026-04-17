import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, BookOpen, Users, Activity, Plug, Bot,
  Zap, LogOut, ChevronRight
} from 'lucide-react';
import { useAuth } from '../context/useAuth';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/live', icon: Activity, label: 'Live' },
  { to: '/crm', icon: Users, label: 'CRM' },
  { to: '/playbooks', icon: BookOpen, label: 'Playbooks' },
  { to: '/integrations', icon: Plug, label: 'Integrations' },
  { to: '/ai', icon: Bot, label: 'AI Layer' },
];

function NavItem({ to, icon, label }) {
  const NavIcon = icon;
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group
        ${isActive
          ? 'bg-brand-500/15 text-brand-400 border border-brand-500/20'
          : 'text-gray-400 hover:text-white hover:bg-dark-700'}`
      }
    >
      {({ isActive }) => (
        <>
          <NavIcon size={18} className={isActive ? 'text-brand-400' : 'text-gray-500 group-hover:text-gray-300'} />
          <span className="flex-1">{label}</span>
          {isActive && <ChevronRight size={14} className="text-brand-400/60" />}
        </>
      )}
    </NavLink>
  );
}

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside className="w-60 shrink-0 bg-dark-800 border-r border-dark-600 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-dark-600">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center">
            <Zap size={18} className="text-white" />
          </div>
          <div>
            <p className="font-bold text-white text-lg leading-none">Nuvanx</p>
            <p className="text-xs text-gray-500 leading-none mt-0.5">Revenue Intelligence</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wider px-3 mb-2">Platform</p>
        {navItems.map((item) => (
          <NavItem key={item.to} to={item.to} icon={item.icon} label={item.label} />
        ))}
      </nav>

      {/* User section */}
      <div className="px-4 py-4 border-t border-dark-600">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-sm font-bold">
            {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{user?.name || 'User'}</p>
            <p className="text-xs text-gray-500 truncate">{user?.email || 'user@example.com'}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors duration-150"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
