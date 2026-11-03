import type { User } from '../../types';

export interface ActivityViewProps {
  workspaceId: string;
  currentUser: User;
}

/** Sidebar "Activity" view (mentions, reactions, replies). Core stub — owned by `notifications`. */
export default function ActivityView(_props: ActivityViewProps) {
  return (
    <div className="view">
      <header className="view-head"><h2>Activity</h2></header>
      <div className="empty">Mentions, reactions and replies will show up here.</div>
    </div>
  );
}
