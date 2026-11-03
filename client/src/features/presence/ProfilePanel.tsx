import { useNavigate } from 'react-router';
import type { User } from '../../types';
import { useSession } from '../../store/session';
import { openDm } from '../../store/actions';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';

export interface ProfilePanelProps {
  workspaceId: string;
  userId: string;
  currentUser: User;
  onClose(): void;
}

/** Right-panel member profile. Core stub — owned by `presence`. */
export default function ProfilePanel({ workspaceId, userId, currentUser, onClose }: ProfilePanelProps) {
  const member = useSession((s) => s.members[userId]);
  const navigate = useNavigate();
  if (!member) return <aside className="panel"><div className="empty">Unknown member</div></aside>;
  const localTime = (() => {
    try { return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: member.timezone }); } catch { return null; }
  })();
  return (
    <aside className="panel">
      <header className="panel-head">
        <h3>Profile</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close profile"><Icon name="x" /></button>
      </header>
      <div className="panel-scroll profile">
        <Avatar user={member} size={160} className="profile-avatar" />
        <h2>{member.fullName}</h2>
        {member.displayName && <div className="muted">@{member.displayName}</div>}
        {member.title && <div>{member.title}</div>}
        {(member.statusEmoji || member.statusText) && <div className="profile-status">{member.statusEmoji} {member.statusText}</div>}
        {localTime && <div className="muted small">{localTime} local time</div>}
        <dl className="profile-fields">
          <dt>Email</dt><dd>{member.email}</dd>
          {member.pronouns && <><dt>Pronouns</dt><dd>{member.pronouns}</dd></>}
          {member.phone && <><dt>Phone</dt><dd>{member.phone}</dd></>}
          <dt>Role</dt><dd className="cap">{member.role}</dd>
        </dl>
        <button className="btn btn-primary" onClick={async () => {
          const c = await openDm(workspaceId, member.id === currentUser.id ? [] : [member.id]);
          navigate(`/w/${workspaceId}/c/${c.id}`);
        }}>Message</button>
      </div>
    </aside>
  );
}
