import type { User } from '../../types';

export interface AppsViewProps {
  workspaceId: string;
  currentUser: User;
}

/** Sidebar "Apps" view (bots, webhooks, slash commands). Core stub — owned by `apps`. */
export default function AppsView(_props: AppsViewProps) {
  return (
    <div className="view">
      <header className="view-head"><h2>Apps</h2></header>
      <div className="empty">Bots, incoming webhooks and slash commands will be managed here.</div>
    </div>
  );
}
