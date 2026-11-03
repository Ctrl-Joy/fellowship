import type { Conversation, User } from '../../types';

export interface CanvasViewProps {
  workspaceId: string;
  /** The channel whose canvas tab is open (standalone canvases may pass canvasId instead). */
  conversation?: Conversation;
  canvasId?: string;
  currentUser: User;
}

/** Canvas document view (conversation "Canvas" tab). Core stub — owned by `canvases`. */
export default function CanvasView(_props: CanvasViewProps) {
  return <div className="empty">Canvases are coming soon.</div>;
}
