import { Link } from 'react-router';
import type { Message } from '../../types';
import type { ItemStatus, ItemType, Priority } from './types';
import { PRIORITY_LABEL, TYPE_LABEL } from './types';
import { useProjects } from './store';
import { PriorityIcon, StatusPill, TypeIcon } from './ui';
import { useSession } from '../../store/session';
import './shell.css';

interface CardMeta { id: string; key: string; summary: string; status: ItemStatus; priority: Priority; type: ItemType; projectId?: string; projectName?: string; assigneeId?: string | null }

/** Compact card for chat messages with subtype 'work_item'; shows live status when the item is loaded. */
export default function WorkItemCard({ message }: { message: Message }) {
  const meta = (message.meta as { workItem?: CardMeta } | null)?.workItem;
  const live = useProjects((s) => (meta?.id ? s.items[meta.id] : undefined));
  const wid = useSession((s) => s.workspaceId);
  if (message.subtype !== 'work_item' || !meta?.id || !wid || message.deletedAt) return null;
  const summary = live?.summary ?? meta.summary;
  const status = live?.status ?? meta.status;
  const priority = live?.priority ?? meta.priority ?? 'none';
  const type = live?.type ?? meta.type ?? 'task';
  return (
    <Link className="pj-wi-card" to={`/w/${wid}/projects/item/${meta.id}`} aria-label={`${meta.key}: ${summary}`}>
      <span className="pj-wi-top">
        <TypeIcon type={type} />
        <span className="pj-wi-key">{live?.key ?? meta.key}</span>
        {meta.projectName && <span className="pj-wi-space">· {meta.projectName}</span>}
      </span>
      <span className={`pj-wi-summary${status === 'done' ? ' done' : ''}`}>{summary}</span>
      <span className="pj-wi-meta">
        <StatusPill status={status} />
        <span className="pj-wi-prio" title={`${PRIORITY_LABEL[priority]} priority`}><PriorityIcon priority={priority} size={14} /> {PRIORITY_LABEL[priority]}</span>
        <span className="pj-wi-type">{TYPE_LABEL[type]}</span>
        <span className="pj-wi-open">Open</span>
      </span>
    </Link>
  );
}
