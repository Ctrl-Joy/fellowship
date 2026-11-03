import { useThreads, countUnreadThreads } from './store';

/** Live count of followed threads with unread replies, for the sidebar "Threads" item. */
export default function UnreadThreadsBadge() {
  const n = useThreads((s) => countUnreadThreads(s.byRoot));
  if (n <= 0) return null;
  return <span className="badge threads-badge" aria-label={`${n} unread threads`}>{n}</span>;
}
