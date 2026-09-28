import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/AuthContext';
import Layout from './components/Layout';
import PageBackground from './components/PageBackground';
import VersionLabel from './components/VersionLabel';
import { useVisualEffects } from './lib/visualEffects';
import SetupPage from './pages/SetupPage';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import CreateServerWizard from './pages/CreateServerWizard';
import ServerDetail from './pages/ServerDetail';
import ModpackEditor from './pages/ModpackEditor';
import WorkshopPackEditor from './pages/WorkshopPackEditor';
import SettingsPage from './pages/SettingsPage';

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex h-screen items-center justify-center">{children}</div>;
}

function Gate({ children }: { children: React.ReactNode }) {
  const { status, loading, error, refresh } = useAuth();

  if (error && !status) {
    return (
      <Center>
        <div className="card max-w-sm px-6 py-5 text-center">
          <p className="text-sm text-red-300">{error}</p>
          <button className="btn-secondary mt-4" onClick={() => refresh()}>
            Try again
          </button>
        </div>
      </Center>
    );
  }

  if (loading || !status) {
    return (
      <Center>
        <p className="text-base-500">Loading Outpost…</p>
      </Center>
    );
  }
  if (status.needsSetup) return <Navigate to="/setup" replace />;
  if (!status.authenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  // The hillside itself is a static SVG and always renders; this only controls whether its trees
  // sway, which is dropped on a machine that can't keep up.
  const effectsOn = useVisualEffects();

  return (
    <>
      <PageBackground animate={effectsOn} />
      {/* Outside <Routes> so it shows on every screen, including login and first-run setup. */}
      <VersionLabel />
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <Gate>
              <Layout />
            </Gate>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="servers/new" element={<CreateServerWizard />} />
          <Route path="servers/:id" element={<ServerDetail />} />
          <Route path="modpacks/:id" element={<ModpackEditor />} />
          <Route path="workshop-packs/:id" element={<WorkshopPackEditor />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </>
  );
}
