import { useNavigate } from 'react-router';
import type { Message } from '../../types';
import { Icon } from '../../components/Icon';
import './canvases.css';

/** Card shown under a `canvas_share` message. Renders nothing for other messages. */
export default function CanvasShareCard({ message }: { message: Message }) {
  const navigate = useNavigate();
  const meta = message.meta as { canvasId?: string; title?: string; workspaceId?: string; role?: string } | null;
  if (message.subtype !== 'canvas_share' || !meta?.canvasId || !meta.workspaceId) return null;
  return (
    <button className="cv-card" onClick={() => navigate(`/w/${meta.workspaceId}/canvases/${meta.canvasId}`)}>
      <span className="cv-card-icon"><Icon name="canvas" size={20} /></span>
      <span className="cv-card-body">
        <b>{meta.title || 'Untitled canvas'}</b>
        <span className="muted small">Canvas · {meta.role === 'viewer' ? 'view only' : 'members can edit'}</span>
      </span>
      <span className="cv-card-open">Open</span>
    </button>
  );
}
