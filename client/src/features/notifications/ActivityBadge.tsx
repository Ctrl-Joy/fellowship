import { useNotifications } from './store';

/** Unread count next to the sidebar "Activity" link. */
export default function ActivityBadge() {
  const unread = useNotifications((s) => s.unread);
  if (unread <= 0) return null;
  return (
    <span className="badge act-badge" aria-label={`${unread} unread activity`}>
      {unread > 99 ? '99+' : unread}
    </span>
  );
}
