import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/AuthContext';
import Layout from './components/Layout';
import SetupPage from './pages/SetupPage';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import CreateServerWizard from './pages/CreateServerWizard';
import ServerDetail from './pages/ServerDetail';
import ModpackList from './pages/ModpackList';
import ModpackEditor from './pages/ModpackEditor';

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex h-screen items-center justify-center bg-base-950">{children}</div>;
}

function Gate({ children }: { children: React.ReactNode }) {
  const { status, loading } = useAuth();

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
  return (
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
        <Route path="modpacks" element={<ModpackList />} />
        <Route path="modpacks/:id" element={<ModpackEditor />} />
      </Route>
    </Routes>
  );
}
