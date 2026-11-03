import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { User } from '../types';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { logout } from '../store/actions';
import { Icon } from '../components/Icon';
import { Avatar, initials } from '../components/Avatar';
import PresenceDot from '../features/presence/PresenceDot';

/** Far-left rail: workspaces, top-level destinations, and the account controls at the bottom. */
export function WorkspaceRail({ currentUser }: { currentUser: User }) {
  const workspaces = useSession((s) => s.workspaces);
  const current = useSession((s) => s.workspaceId);
  const { theme, toggleTheme, sidebarMode, setSidebarMode, openModal, openRightPanel } = useUi();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  const base = `/w/${current}`;

  const dest = [
    { key: 'home', label: 'Home', icon: 'home', active: sidebarMode === 'home' && !/\/(activity|saved|apps|workflows)$/.test(pathname),
      go: () => { setSidebarMode('home'); navigate(base); } },
    { key: 'dms', label: 'DMs', icon: 'messages', active: sidebarMode === 'dms' && !/\/(activity|saved|apps|workflows)$/.test(pathname),
      go: () => setSidebarMode('dms') },
    { key: 'activity', label: 'Activity', icon: 'bell', active: pathname.endsWith('/activity'), go: () => navigate(`${base}/activity`) },
    { key: 'saved', label: 'Later', icon: 'bookmark', active: pathname.endsWith('/saved'), go: () => navigate(`${base}/saved`) },
    { key: 'tools', label: 'Tools', icon: 'grid', active: /\/(apps|workflows)$/.test(pathname), go: () => navigate(`${base}/apps`) },
  ];

  return (
    <nav className="rail" aria-label="Workspaces and destinations">
      <div className="rail-list">
        {workspaces.map((w) => (
          <button key={w.id} className={`rail-ws${w.id === current ? ' active' : ''}`} title={w.name}
            onClick={() => navigate(`/w/${w.id}`)}>
            {w.iconUrl ? <img src={w.iconUrl} alt="" /> : initials(w.name).slice(0, 1)}
          </button>
        ))}
      </div>
      <div className="rail-dest">
        {dest.map((d) => (
          <button key={d.key} className={`rail-btn${d.active ? ' active' : ''}`} onClick={d.go}>
            <span className="rail-btn-icon"><Icon name={d.icon} size={20} /></span>
            <span className="rail-btn-label">{d.label}</span>
          </button>
        ))}
      </div>
      <div className="rail-bottom">
        <button className="rail-round" title="Add a workspace" onClick={() => navigate('/workspaces')}><Icon name="plus" size={20} /></button>
        <button className="rail-round" title={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={toggleTheme}>
          <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={20} />
        </button>
        <button className="rail-round rail-signout" title="Sign out" aria-label="Sign out" onClick={async () => { await logout(); navigate('/login'); }}>
          <Icon name="logout" size={19} />
        </button>
        <div className="me-menu">
          <button className="rail-me" onClick={() => setMenu((v) => !v)} aria-label="Your account">
            <span className="avatar-wrap"><Avatar user={currentUser} size={40} /><PresenceDot userId={currentUser.id} size={11} /></span>
          </button>
          {menu && (
            <div className="menu menu-up" onMouseLeave={() => setMenu(false)}>
              <div className="menu-user">
                <Avatar user={currentUser} size={36} />
                <div>
                  <strong>{currentUser.fullName}</strong>
                  <div className="muted small">{currentUser.statusEmoji} {currentUser.statusText || currentUser.email}</div>
                </div>
              </div>
              <button onClick={() => { openModal({ kind: 'status' }); setMenu(false); }}>Set a status</button>
              <button onClick={() => { openRightPanel({ kind: 'profile', userId: currentUser.id }); setMenu(false); }}>Profile</button>
              <button onClick={() => { openModal({ kind: 'notificationPrefs' }); setMenu(false); }}>Preferences</button>
              <hr />
              <button className="menu-signout" onClick={async () => { await logout(); navigate('/login'); }}><Icon name="logout" size={15} /> Sign out of Fellowship</button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
