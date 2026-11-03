import type { User } from '../../types';

export interface WorkflowsViewProps {
  workspaceId: string;
  currentUser: User;
}

/** Sidebar "Workflows" view (builder + run history). Core stub — owned by `workflows`. */
export default function WorkflowsView(_props: WorkflowsViewProps) {
  return (
    <div className="view">
      <header className="view-head"><h2>Workflows</h2></header>
      <div className="empty">Automate routine work with workflows — coming soon.</div>
    </div>
  );
}
