import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router';
import { useSession } from '../store/session';
import { useConversations } from '../store/conversations';
import { useUi } from '../store/ui';
import { loadConversations, loadMembers, loadWorkspaces } from '../store/actions';
import { startRealtime } from '../store/realtime';
import { ws } from '../ws';
import { setupFeatures } from '../features';
import { WorkspaceRail } from '../shell/WorkspaceRail';
import { Sidebar } from '../shell/Sidebar';
import { TopBar } from '../shell/TopBar';
import { ConversationView } from '../shell/ConversationView';
import { RightPanel } from '../shell/RightPanel';
import { ChannelBrowser } from '../shell/ChannelBrowser';
import { SavedView } from '../shell/SavedView';
import { Modals } from '../shell/Modals';
import ThreadsView from '../features/threads/ThreadsView';
import ActivityView from '../features/notifications/ActivityView';
import AppsView from '../features/apps/AppsView';
import WorkflowsView from '../features/workflows/WorkflowsView';
import CanvasesPage from '../features/canvases/CanvasesPage';
import SearchResults from '../features/search/SearchResults';
import HuddleWindow from '../features/huddles/HuddleWindow';
import ProjectsRoot from '../features/projects/ProjectsRoot';
import ProjectToasts from '../features/projects/ProjectToasts';

/** The signed-in app shell for /w/:wid/*. */
export function WorkspacePage() {
  const { wid } = useParams<{ wid: string }>();
  const me = useSession((s) => s.me)!;
  const workspaces = useSession((s) => s.workspaces);
  const workspace = workspaces.find((w) => w.id === wid);
  const convLoaded = useConversations((s) => s.loaded);
  const membersLoaded = useSession((s) => s.membersLoaded);
  const rightPanel = useUi((s) => s.rightPanel);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!wid) return;
    setError(null);
    useSession.getState().setWorkspaceId(wid);
    useConversations.getState().reset();
    useUi.getState().closeRightPanel();
    Promise.all([
      workspaces.length ? Promise.resolve() : loadWorkspaces().then(() => {}),
      loadMembers(wid),
      loadConversations(wid),
    ]).catch((e) => {
      if (e.status !== 404) return setError(e.message);
      // A remembered workspace may no longer exist (e.g. after a reseed): forget it and go pick one.
      try { if (localStorage.getItem('fs:lastWorkspace') === wid) localStorage.removeItem('fs:lastWorkspace'); } catch { /* ignore */ }
      navigate('/workspaces', { replace: true });
    });
    startRealtime();
    ws.connect();
    const cleanup = setupFeatures({ workspaceId: wid, me });
    try { localStorage.setItem('fs:lastWorkspace', wid); } catch { /* ignore */ }
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wid]);

  // Global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const ui = useUi.getState();
        if (ui.modal?.kind === 'quickSwitcher') ui.closeModal();
        else ui.openModal({ kind: 'quickSwitcher' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (error) {
    return <div className="center-page"><div className="card-panel"><p>{error}</p><a className="btn btn-primary" href="/workspaces">Back to your workspaces</a></div></div>;
  }
  if (!wid || !workspace || !convLoaded || !membersLoaded) {
    return <div className="center-page"><span className="spinner spinner-lg" /></div>;
  }

  return (
    <div className={`app${rightPanel ? ' with-panel' : ''}`}>
      <WorkspaceRail currentUser={me} />
      <TopBar workspace={workspace} currentUser={me} />
      <Sidebar workspace={workspace} currentUser={me} />
      <main className="main">
        <Routes>
          <Route index element={<DefaultConversation workspaceId={wid} />} />
          <Route path="c/:cid" element={<ConversationView workspaceId={wid} currentUser={me} />} />
          <Route path="browse" element={<ChannelBrowser workspaceId={wid} />} />
          <Route path="saved" element={<SavedView workspaceId={wid} currentUser={me} />} />
          <Route path="threads" element={<ThreadsView workspaceId={wid} currentUser={me} />} />
          <Route path="activity" element={<ActivityView workspaceId={wid} currentUser={me} />} />
          <Route path="apps" element={<AppsView workspaceId={wid} currentUser={me} />} />
          <Route path="workflows" element={<WorkflowsView workspaceId={wid} currentUser={me} />} />
          <Route path="canvases/*" element={<CanvasesPage workspaceId={wid} currentUser={me} />} />
          <Route path="search" element={<SearchRoute workspaceId={wid} />} />
          <Route path="projects/*" element={<ProjectsRoot workspaceId={wid} currentUser={me} />} />
          <Route path="*" element={<Navigate to={`/w/${wid}`} replace />} />
        </Routes>
      </main>
      {rightPanel && <div className="right"><RightPanel workspaceId={wid} currentUser={me} /></div>}
      <Modals workspaceId={wid} currentUser={me} />
      <HuddleWindow workspaceId={wid} currentUser={me} />
      <ProjectToasts />
    </div>
  );
}

function DefaultConversation({ workspaceId }: { workspaceId: string }) {
  const byId = useConversations((s) => s.byId);
  const navigate = useNavigate();
  useEffect(() => {
    let last: string | null = null;
    try { last = localStorage.getItem(`fs:last:${workspaceId}`); } catch { /* ignore */ }
    const target = (last && byId[last]?.isMember && last)
      || Object.values(byId).find((c) => c.kind === 'channel' && c.isDefault)?.id
      || Object.values(byId)[0]?.id;
    if (target) navigate(`/w/${workspaceId}/c/${target}`, { replace: true });
  }, [workspaceId, byId, navigate]);
  return <div className="empty">Pick a conversation to get started.</div>;
}

function SearchRoute({ workspaceId }: { workspaceId: string }) {
  const [params] = useSearchParams();
  const me = useSession((s) => s.me)!;
  return <SearchResults workspaceId={workspaceId} query={params.get('q') ?? ''} currentUser={me} />;
}
