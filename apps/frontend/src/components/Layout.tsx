import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { authApi } from '../lib/api';
import { useAuth } from '../lib/AuthContext';

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-accent-500/15 text-accent-400' : 'text-base-200 hover:bg-base-800 hover:text-base-50'
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
    <div className="flex h-screen bg-base-950">
      <aside className="flex w-60 shrink-0 flex-col border-r border-base-800 p-4">
        <div className="mb-8 flex items-center gap-2 px-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-500 text-base-950 font-bold">
            O
          </div>
          <span className="text-lg font-semibold tracking-tight text-base-50">Outpost</span>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          <NavLink to="/" end className={navItemClass}>
            Servers
          </NavLink>
          <NavLink to="/modpacks" className={navItemClass}>
            Modpack Studio
          </NavLink>
        </nav>

        <div className="border-t border-base-800 pt-3">
          <div className="mb-2 px-1 text-xs text-base-500">Signed in as {status?.username}</div>
          <button className="btn-secondary w-full" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
