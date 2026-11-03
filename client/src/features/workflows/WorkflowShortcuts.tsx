import { useEffect, useRef, useState } from 'react';
import type { Conversation, User } from '../../types';
import { Icon } from '../../components/Icon';
import { wfApi } from './model';
import './workflows.css';

/** Conversation-header button listing published shortcut workflows available here. */
export default function WorkflowShortcuts({ workspaceId, conversation }: { workspaceId: string; conversation: Conversation; currentUser?: User }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ id: string; name: string; emoji: string; description: string }[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setItems(null); setNote(null);
    wfApi.shortcuts(workspaceId, conversation.id).then((r) => setItems(r.shortcuts)).catch((e) => { setItems([]); setNote(e.message); });
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, workspaceId, conversation.id]);

  async function run(id: string, name: string) {
    try {
      await wfApi.run(id, { conversationId: conversation.id });
      setNote(`Started “${name}”.`);
      setTimeout(() => setOpen(false), 900);
    } catch (e: any) { setNote(e.message); }
  }

  return (
    <div className="wf-shortcuts" ref={ref}>
      <button className="icon-btn" title="Run a workflow" aria-label="Run a workflow" onClick={() => setOpen((o) => !o)}><Icon name="workflow" /></button>
      {open && (
        <div className="wf-shortcuts-menu">
          <div className="wf-var-group">Run a workflow</div>
          {items === null && <div className="menu-note">Loading…</div>}
          {items?.length === 0 && !note && <div className="menu-note">No shortcut workflows here yet.</div>}
          {items?.map((s) => (
            <button key={s.id} title={s.description} onClick={() => run(s.id, s.name)}><span>{s.emoji || '⚡'}</span><span>{s.name}</span></button>
          ))}
          {note && <div className="wf-toast">{note}</div>}
        </div>
      )}
    </div>
  );
}
