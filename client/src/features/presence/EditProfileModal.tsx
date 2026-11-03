import { useRef, useState } from 'react';
import type { User } from '../../types';
import { Modal } from '../../components/Modal';
import { Avatar } from '../../components/Avatar';
import { api } from '../../api';
import { useSession } from '../../store/session';
import './presence.css';

export interface EditProfileModalProps {
  currentUser: User;
  onClose(): void;
}

const ALLOWED_AVATAR = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

function timezones(): string[] {
  try {
    const list = (Intl as any).supportedValuesOf?.('timeZone') as string[] | undefined;
    if (list?.length) return list.includes('UTC') ? list : ['UTC', ...list];
  } catch { /* fall through */ }
  return ['UTC', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];
}

const TIMEZONES = timezones();

/** Edit the signed-in user's profile fields and avatar. */
export default function EditProfileModal({ currentUser, onClose }: EditProfileModalProps) {
  const [fullName, setFullName] = useState(currentUser.fullName);
  const [displayName, setDisplayName] = useState(currentUser.displayName);
  const [title, setTitle] = useState(currentUser.title);
  const [pronouns, setPronouns] = useState(currentUser.pronouns);
  const [phone, setPhone] = useState(currentUser.phone);
  const [timezone, setTimezone] = useState(currentUser.timezone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatar, setAvatar] = useState<User>(currentUser);

  const applyUser = (u: User) => {
    useSession.getState().setMe(u);
    useSession.getState().upsertMember(u);
    setAvatar(u);
  };

  const uploadAvatar = async (file: File) => {
    setError(null);
    if (!ALLOWED_AVATAR.includes(file.type)) return setError('Pick a PNG, JPEG, GIF or WebP image.');
    if (file.size > MAX_AVATAR_BYTES) return setError('Avatars must be 2 MB or smaller.');
    const form = new FormData();
    form.append('file', file);
    setBusy(true);
    try {
      const r = await api.upload<{ user: User }>('/api/users/me/avatar', form);
      applyUser(r.user);
    } catch (err: any) {
      setError(err?.message ?? 'Upload failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeAvatar = async () => {
    setBusy(true);
    try {
      const r = await api.del<{ user: User }>('/api/users/me/avatar');
      applyUser(r.user);
    } catch (err: any) {
      setError(err?.message ?? 'Could not remove the photo');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.patch<{ user: User }>('/api/users/me', {
        fullName: fullName.trim(), displayName: displayName.trim(), title: title.trim(),
        pronouns: pronouns.trim(), phone: phone.trim(), timezone,
      });
      applyUser(r.user);
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Could not save your profile');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Edit profile" onClose={onClose} width={600} footer={<>
      <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={busy || !fullName.trim()}>Save changes</button>
    </>}>
      <div className="edit-avatar-row">
        <Avatar user={avatar} size={72} />
        <div className="row gap-sm" style={{ flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>Upload photo</button>
          {avatar.avatarUrl && <button className="btn btn-ghost" onClick={removeAvatar} disabled={busy}>Remove</button>}
          <input ref={fileRef} type="file" accept={ALLOWED_AVATAR.join(',')} hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadAvatar(f); }} />
          <span className="muted small" style={{ width: '100%' }}>PNG, JPEG, GIF or WebP, up to 2 MB.</span>
        </div>
      </div>

      <div className="edit-grid">
        <label className="field">
          <span>Full name</span>
          <input className="input" value={fullName} maxLength={80} onChange={(e) => setFullName(e.target.value)} />
        </label>
        <label className="field">
          <span>Display name <span className="muted">(optional)</span></span>
          <input className="input" value={displayName} maxLength={80} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label className="field span-2">
          <span>Title <span className="muted">(optional)</span></span>
          <input className="input" value={title} maxLength={120} placeholder="What do you do?" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>Pronouns</span>
          <input className="input" value={pronouns} maxLength={40} placeholder="e.g. she/her" onChange={(e) => setPronouns(e.target.value)} />
        </label>
        <label className="field">
          <span>Phone</span>
          <input className="input" value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="field span-2">
          <span>Time zone</span>
          <select className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {!TIMEZONES.includes(timezone) && <option value={timezone}>{timezone}</option>}
            {TIMEZONES.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="edit-error" role="alert">{error}</p>}
    </Modal>
  );
}
