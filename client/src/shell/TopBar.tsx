import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { User, Workspace } from '../types';
import { useUi } from '../store/ui';
import { logout } from '../store/actions';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import SearchBox from '../features/search/SearchBox';
import PresenceDot from '../features/presence/PresenceDot';

export function TopBar({ workspace, currentUser }: { workspace: Workspace; currentUser: User }) {
  const navigate = useNavigate();
  const theme = useUi((s) => s.theme);
  const toggleTheme = useUi((s) => s.toggleTheme);
  const openModal = useUi((s) => s.openModal);
  const openPanel = useUi((s) => s.openRightPanel);
  const [menu, setMenu] = useState(false);

  return (
    <header className="topbar">
      <div className="topbar-nav">
        <button className="icon-btn" title="Back" onClick={() => navigate(-1)}><Icon name="back" /></button>
        <button className="icon-btn" title="Forward" onClick={() => navigate(1)}><Icon name="forward" /></button>
      </div>
      <div className="topbar-search">
        <SearchBox workspaceId={workspace.id} workspaceName={workspace.name} />
        <button className="kbd-hint" onClick={() => openModal({ kind: 'quickSwitcher' })} title="Jump to… (Ctrl+K)">Ctrl K</button>
      </div>
      <div className="topbar-right">
        <button className="icon-btn" title={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={toggleTheme}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        <div className="me-menu">
          <button className="avatar-btn" onClick={() => setMenu((v) => !v)} aria-label="Your account">
            <span className="avatar-wrap"><Avatar user={currentUser} size={28} /><PresenceDot userId={currentUser.id} size={9} /></span>
          </button>
          {menu && (
            <div className="menu menu-right" onMouseLeave={() => setMenu(false)}>
              <div className="menu-user">
                <Avatar user={currentUser} size={36} />
                <div>
                  <strong>{currentUser.fullName}</strong>
                  <div className="muted small">{currentUser.statusEmoji} {currentUser.statusText || currentUser.email}</div>
                </div>
              </div>
              <button onClick={() => { openModal({ kind: 'status' }); setMenu(false); }}>Set a status</button>
              <button onClick={() => { openPanel({ kind: 'profile', userId: currentUser.id }); setMenu(false); }}>Profile</button>
              <button onClick={() => { openModal({ kind: 'notificationPrefs' }); setMenu(false); }}>Preferences</button>
              <hr />
              <button onClick={async () => { await logout(); navigate('/login'); }}>Sign out of Fellowship</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
