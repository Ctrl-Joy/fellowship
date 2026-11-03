import type { User } from '../types';
import { useSession } from '../store/session';

const HUES = [168, 32, 205, 350, 265, 120, 15, 190];

function hueFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** User avatar: image if set, otherwise initials on a colour derived from the id. */
export function Avatar({ user, userId, size = 36, className = '' }: {
  user?: Pick<User, 'id' | 'fullName' | 'displayName' | 'avatarUrl'> | null;
  userId?: string;
  size?: number;
  className?: string;
}) {
  const fromStore = useSession((s) => (userId ? s.members[userId] : undefined));
  const u = user ?? fromStore;
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.4), borderRadius: Math.round(size * 0.24) };
  if (u?.avatarUrl) return <img className={`avatar ${className}`} src={u.avatarUrl} alt="" style={style} />;
  const id = u?.id ?? userId ?? '?';
  return (
    <span className={`avatar avatar-initials ${className}`} style={{ ...style, background: `hsl(${hueFor(id)} 45% 42%)` }} aria-hidden="true">
      {initials(u?.fullName || u?.displayName || '?')}
    </span>
  );
}
