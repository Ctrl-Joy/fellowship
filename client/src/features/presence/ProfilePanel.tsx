import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Member, User } from '../../types';
import { useSession } from '../../store/session';
import { logout, openDm } from '../../store/actions';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import PresenceDot from './PresenceDot';
import { usePresence, presenceLabel } from './store';
import { formatUntil } from './statusOptions';
import EditProfileModal from './EditProfileModal';
import './presence.css';

export interface ProfilePanelProps {
  workspaceId: string;
  userId: string;
  currentUser: User;
  onClose(): void;
}

/** Local time for a timezone, or null if the zone is unknown to this browser. */
function localTime(timeZone: string): string | null {
  try {
    return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone });
  } catch {
    return null;
  }
}

/** Right-panel profile: avatar, name, title, status, presence, local time and quick actions. */
export default function ProfilePanel({ workspaceId, userId, currentUser, onClose }: ProfilePanelProps) {
  const member = useSession((s) => s.members[userId]) as Member | undefined;
  const isMe = userId === currentUser.id;
  const person: User | undefined = member ?? (isMe ? currentUser : undefined);
  const state = usePresence((s) => s.byUser[userId]);
  const manualAway = usePresence((s) => s.manualAway);
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!person) return <aside className="panel"><div className="empty">Unknown member</div></aside>;

  const time = localTime(person.timezone);
  const statusLive = !!(person.statusEmoji || person.statusText);
  const openConversation = async (huddle: boolean) => {
    setBusy(true);
    try {
      const c = await openDm(workspaceId, [person.id]);
      navigate(`/w/${workspaceId}/c/${c.id}`);
      if (huddle) {
        // The huddles feature listens for this to start a call in the conversation.
        window.dispatchEvent(new CustomEvent('fellowship:start-huddle', { detail: { workspaceId, conversationId: c.id } }));
      }
    } catch {
      /* the header will show the error state if the DM could not be opened */
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="panel">
      <header className="panel-head">
        <h3>Profile</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close profile"><Icon name="x" /></button>
      </header>
      <div className="panel-scroll profile">
        <span className="avatar-wrap profile-avatar-wrap">
          <Avatar user={person} size={160} className="profile-avatar" />
          <PresenceDot userId={person.id} size={22} />
        </span>

        <div className="profile-name-row">
          <h2>{person.fullName}</h2>
          {person.isBot && <span className="badge-app">APP</span>}
        </div>
        {(person.displayName && person.displayName !== person.fullName) && <div className="muted">@{person.displayName}</div>}
        {person.title && <div>{person.title}</div>}
        {person.pronouns && <div className="muted small">{person.pronouns}</div>}

        {statusLive && (
          <div className="profile-status">
            {person.statusEmoji} {person.statusText}
            {person.statusExpires != null && <span className="profile-status-until">{formatUntil(person.statusExpires)}</span>}
          </div>
        )}

        <div className="presence-line">
          <PresenceDot userId={person.id} size={10} />
          {presenceLabel(state)}
          {isMe && manualAway && <span className="muted small">· set to appear away</span>}
        </div>

        {time && (
          <div className="profile-local-time muted small">
            {time} local time ({person.timezone.replace(/_/g, ' ')})
          </div>
        )}

        {!isMe && (
          <div className="profile-actions">
            <button className="btn btn-primary" onClick={() => openConversation(false)} disabled={busy}>
              <Icon name="send" size={14} /> Message
            </button>
            <button className="btn" onClick={() => openConversation(true)} disabled={busy}>
              <Icon name="headphones" size={15} /> Huddle
            </button>
          </div>
        )}
        {isMe && (
          <div className="profile-actions">
            <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={14} /> Edit profile</button>
            <button className="btn btn-signout" disabled={busy} onClick={async () => { setBusy(true); await logout(); navigate('/login'); }}>
              <Icon name="logout" size={14} /> Sign out
            </button>
          </div>
        )}

        <dl className="profile-fields">
          <dt>Email</dt><dd>{person.email}</dd>
          {person.phone && <><dt>Phone</dt><dd>{person.phone}</dd></>}
          {member && <><dt>Role</dt><dd className="cap">{member.role}</dd></>}
        </dl>
      </div>
      {editing && <EditProfileModal currentUser={isMe ? person : currentUser} onClose={() => setEditing(false)} />}
    </aside>
  );
}
