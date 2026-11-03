import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { api } from './api';
import { useSession } from './store/session';
import { applyTheme, useUi } from './store/ui';
import type { User } from './types';
import { AuthPage } from './pages/AuthPage';
import { JoinPage, WorkspacesPage } from './pages/WorkspacesPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { LandingPage } from './pages/LandingPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const me = useSession((s) => s.me);
  const location = useLocation();
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

function Home() {
  let last: string | null = null;
  try { last = localStorage.getItem('fs:lastWorkspace'); } catch { /* ignore */ }
  return <Navigate to={last ? `/w/${last}` : '/workspaces'} replace />;
}

export function App() {
  const loaded = useSession((s) => s.loaded);
  const me = useSession((s) => s.me);
  const theme = useUi((s) => s.theme);

  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => {
    api.get<{ user: User }>('/api/auth/me')
      .then((r) => useSession.getState().setMe(r.user))
      .catch(() => useSession.getState().setMe(null));
  }, []);

  if (!loaded) return <div className="center-page"><span className="spinner spinner-lg" /></div>;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={me ? <Navigate to="/" replace /> : <AuthPage mode="login" />} />
        <Route path="/signup" element={me ? <Navigate to="/" replace /> : <AuthPage mode="signup" />} />
        <Route path="/workspaces" element={<RequireAuth><WorkspacesPage /></RequireAuth>} />
        <Route path="/join/:code" element={<RequireAuth><JoinPage /></RequireAuth>} />
        <Route path="/w/:wid/*" element={<RequireAuth><WorkspacePage /></RequireAuth>} />
        <Route path="/welcome" element={<LandingPage />} />
        <Route path="/" element={me ? <Home /> : <LandingPage />} />
        <Route path="*" element={<RequireAuth><Home /></RequireAuth>} />
      </Routes>
    </BrowserRouter>
  );
}
