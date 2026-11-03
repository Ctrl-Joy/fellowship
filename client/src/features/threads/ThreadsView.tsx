import type { User } from '../../types';

export interface ThreadsViewProps {
  workspaceId: string;
  currentUser: User;
}

/** Sidebar "Threads" view (threads you follow). Core stub — owned by `threads`. */
export default function ThreadsView(_props: ThreadsViewProps) {
  return (
    <div className="view">
      <header className="view-head"><h2>Threads</h2></header>
      <div className="empty">Threads you take part in will show up here.</div>
    </div>
  );
}
