import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { FiSettings } from 'react-icons/fi';
import { authApi } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import Logo from './Logo';

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${
    isActive
      ? 'bg-accent-500/15 text-accent-400'
      : 'text-base-200 hover:bg-base-900 hover:text-base-50'
  }`;

export default function Layout() {
  const { status, refresh } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await authApi.logout();
    await refresh();
    navigate('/login');
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-6 border-b border-base-800 px-6 py-3">
        <div className="flex items-center gap-2">
          <Logo className="h-8 w-8" />
          <span className="brand-text text-lg font-semibold tracking-tight">Outpost</span>
        </div>

        <nav className="flex items-center gap-1">
          <NavLink to="/" end className={navItemClass}>
            Servers
          </NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-xs text-base-500 sm:inline">
            Signed in as {status?.username}
          </span>
          <NavLink
            to="/settings"
            title="Settings"
            className={({ isActive }) =>
              `flex h-8 w-8 items-center justify-center rounded-xl transition-colors ${
                isActive
                  ? 'bg-accent-500/15 text-accent-400'
                  : 'text-base-300 hover:bg-base-900 hover:text-base-50'
              }`
            }
          >
            <FiSettings className="h-4 w-4" />
          </NavLink>
          <button className="btn-secondary !py-1.5" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
