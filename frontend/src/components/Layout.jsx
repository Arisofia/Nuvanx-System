import { Outlet } from 'react-router-dom';

export default function Layout() {
  return (
    <div className="min-h-screen bg-dark-900 text-white">
      <Outlet />
    </div>
  );
}
