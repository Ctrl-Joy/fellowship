import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { api } from './api';
import { useSession } from './store/session';
import { applyTheme, useUi } from './store/ui';
import type { User } from './types';

// Each screen loads on demand, so visitors to the landing page do not download the app and the reverse.
const AuthPage = lazy(() => import('./pages/AuthPage').then((m) => ({ default: m.AuthPage })));
const ForgotPasswordPage = lazy(() => import('./pages/VerifyPages').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('./pages/VerifyPages').then((m) => ({ default: m.ResetPasswordPage })));
const VerifyPage = lazy(() => import('./pages/VerifyPages').then((m) => ({ default: m.VerifyPage })));
const JoinPage = lazy(() => import('./pages/WorkspacesPage').then((m) => ({ default: m.JoinPage })));
const WorkspacesPage = lazy(() => import('./pages/WorkspacesPage').then((m) => ({ default: m.WorkspacesPage })));
const WorkspacePage = lazy(() => import('./pages/WorkspacePage').then((m) => ({ default: m.WorkspacePage })));
const LandingPage = lazy(() => import('./pages/LandingPage').then((m) => ({ default: m.LandingPage })));
const OrbitLanding = lazy(() => import('./pages/OrbitLanding').then((m) => ({ default: m.OrbitLanding })));
const EditionsLanding = lazy(() => import('./pages/EditionsLanding').then((m) => ({ default: m.EditionsLanding })));
const SpotlightLanding = lazy(() => import('./pages/SpotlightLanding').then((m) => ({ default: m.SpotlightLanding })));
const HeroLanding = lazy(() => import('./pages/HeroLanding').then((m) => ({ default: m.HeroLanding })));
const FellowshipLanding = lazy(() => import('./pages/FellowshipLanding').then((m) => ({ default: m.FellowshipLanding })));
const ExplorePage = lazy(() => import('./pages/explore/ExplorePage').then((m) => ({ default: m.ExplorePage })));

// Deep links into a workspace start fetching the app shell right away, alongside the session check.
if (typeof window !== 'undefined' && window.location.pathname.startsWith('/w/')) {
  void import('./pages/WorkspacePage');
  if (window.location.pathname.includes('/projects')) void import('./features/projects/ProjectsRoot');
}

const Loading = () => <div className="center-page"><span className="spinner spinner-lg" /></div>;

function RequireAuth({ children }: { children: ReactNode }) {
  const me = useSession((s) => s.me);
  const location = useLocation();
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

/** Where a signed-in visitor to an auth screen belongs: the page they were sent to sign in for, if any. */
function AfterAuth() {
  const next = new URLSearchParams(useLocation().search).get('next');
  // Only same-site paths: "/join/abc" yes, "//evil.example" or "https://…" no.
  const safe = next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
  return <Navigate to={safe} replace />;
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

  if (!loaded) return <Loading />;

  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={me ? <AfterAuth /> : <AuthPage mode="login" />} />
        <Route path="/signup" element={me ? <AfterAuth /> : <AuthPage mode="signup" />} />
        <Route path="/verify" element={me ? <AfterAuth /> : <VerifyPage />} />
        <Route path="/forgot-password" element={me ? <AfterAuth /> : <ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/workspaces" element={<RequireAuth><WorkspacesPage /></RequireAuth>} />
        <Route path="/join/:code" element={<RequireAuth><JoinPage /></RequireAuth>} />
        <Route path="/w/:wid/*" element={<RequireAuth><WorkspacePage /></RequireAuth>} />
        <Route path="/welcome" element={<FellowshipLanding />} />
        <Route path="/explore/:slug" element={<ExplorePage />} />
        <Route path="/welcome/hero" element={<HeroLanding />} />
        <Route path="/welcome/spotlight" element={<SpotlightLanding />} />
        <Route path="/welcome/scenes" element={<LandingPage />} />
        <Route path="/welcome/orbit" element={<OrbitLanding />} />
        <Route path="/welcome/editions" element={<EditionsLanding />} />
        <Route path="/" element={me ? <Home /> : <FellowshipLanding />} />
        <Route path="*" element={<RequireAuth><Home /></RequireAuth>} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
