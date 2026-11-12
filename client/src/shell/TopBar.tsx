import { useCallback, useState } from 'react';
import { useDismiss } from '../components/useDismiss';
import { useNavigate } from 'react-router';
import type { User, Workspace } from '../types';
import { useUi } from '../store/ui';
import { Icon } from '../components/Icon';
import SearchBox from '../features/search/SearchBox';

const SHORTCUTS: [string, string][] = [
  ['Ctrl K', 'Jump to a conversation'],
  ['Enter', 'Send message'],
  ['Shift Enter', 'New line'],
  ['↑', 'Edit your last message'],
  ['Esc', 'Mark conversation as read'],
];

export function TopBar({ workspace, onMenu }: { workspace: Workspace; currentUser: User; onMenu?: () => void }) {
  const navigate = useNavigate();
  const openModal = useUi((s) => s.openModal);
  const [help, setHelp] = useState(false);
  const closeHelp = useCallback(() => setHelp(false), []);
  useDismiss(help, closeHelp);

  return (
    <header className="topbar">
      <button className="icon-btn topbar-menu" title="Channels and navigation" aria-label="Open navigation" onClick={onMenu}>
        <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4.5h12M2 8h12M2 11.5h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
      <div className="topbar-nav">
        <button className="icon-btn" title="Back" onClick={() => navigate(-1)}><Icon name="back" /></button>
        <button className="icon-btn" title="Forward" onClick={() => navigate(1)}><Icon name="forward" /></button>
        <button className="icon-btn" title="Jump to… (Ctrl+K)" onClick={() => openModal({ kind: 'quickSwitcher' })}><Icon name="clock" /></button>
      </div>
      <div className="topbar-search">
        <SearchBox workspaceId={workspace.id} workspaceName={workspace.name} />
      </div>
      <div className="topbar-right me-menu">
        <button className="icon-btn" title="Help" onClick={() => setHelp((v) => !v)}><Icon name="help" /></button>
        {help && (
          <div className="menu menu-right">
            <div className="menu-note"><strong>Keyboard shortcuts</strong></div>
            {SHORTCUTS.map(([k, d]) => (
              <div key={k} className="shortcut-row"><span>{d}</span><kbd>{k}</kbd></div>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
