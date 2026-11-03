import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { User } from '../../types';
import { useSession, displayName } from '../../store/session';
import { timeAgo } from '../../lib/time';
import { Modal } from '../../components/Modal';
import { TRIGGER_INFO, wfApi, type Template, type Workflow } from './model';
import { WorkflowEditor } from './WorkflowEditor';
import { StatusPill } from './RunHistory';
import { useWorkflowRuns } from './store';
import './workflows.css';

export interface WorkflowsViewProps {
  workspaceId: string;
  currentUser: User;
}

/** Sidebar "Workflows" view: list (mine / workspace), templates, and the builder. */
export default function WorkflowsView({ workspaceId }: WorkflowsViewProps) {
  const [params, setParams] = useSearchParams();
  const openId = params.get('wf');
  const open = (id: string | null) => setParams(id ? { wf: id } : {}, { replace: false });
  if (openId) return <WorkflowEditor key={openId} id={openId} onBack={() => open(null)} />;
  return <WorkflowList workspaceId={workspaceId} onOpen={open} />;
}

function WorkflowList({ workspaceId, onOpen }: { workspaceId: string; onOpen(id: string): void }) {
  const [scope, setScope] = useState<'mine' | 'workspace'>('mine');
  const [list, setList] = useState<Workflow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const seq = useWorkflowRuns((s) => s.seq);
  const live = useWorkflowRuns((s) => s.byId);
  const members = useSession((s) => s.members);

  useEffect(() => {
    let alive = true;
    wfApi.list(workspaceId, scope).then((r) => { if (alive) setList(r.workflows); }).catch((e) => setError(e.message));
    return () => { alive = false; };
  }, [workspaceId, scope, seq]);

  return (
    <div className="view">
      <header className="view-head">
        <h2>Workflows</h2>
        <div className="wf-tabs">
          <button className={scope === 'mine' ? 'active' : ''} onClick={() => setScope('mine')}>Mine</button>
          <button className={scope === 'workspace' ? 'active' : ''} onClick={() => setScope('workspace')}>Workspace</button>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>New workflow</button>
      </header>
      <div className="view-scroll">
        {error && <div className="form-error">{error}</div>}
        {!list && !error && <div className="muted wf-pad">Loading…</div>}
        {list && list.length === 0 && (
          <div className="empty">
            <p>{scope === 'mine' ? 'You have no workflows yet.' : 'Nobody has published a workflow yet.'}</p>
            <p>Automate routine work: greet newcomers, collect stand-ups, route approvals.</p>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>Create a workflow</button>
          </div>
        )}
        {list && list.length > 0 && (
          <div className="wf-grid" style={{ marginTop: 12 }}>
            {list.map((w) => {
              const last = w.lastRun ? (live[w.lastRun.id] ?? w.lastRun) : null;
              return (
                <button key={w.id} className="wf-tile" onClick={() => onOpen(w.id)}>
                  <div className="wf-tile-head">
                    <span className="wf-tile-emoji">{w.emoji || '⚡'}</span>
                    <span className="wf-tile-name">{w.name}</span>
                    <span className={`wf-pill ${w.status === 'published' ? 'wf-pill-ok' : 'wf-pill-muted'}`}>{w.status === 'published' ? 'Live' : 'Draft'}</span>
                  </div>
                  {w.description && <div className="wf-tile-desc">{w.description}</div>}
                  <div className="wf-tile-foot">
                    <span>{TRIGGER_INFO[w.triggerType]?.icon} {TRIGGER_INFO[w.triggerType]?.label}</span>
                    <span className="grow" />
                    {last ? <><StatusPill status={last.status} /> {timeAgo(last.startedAt)}</>
                      : scope === 'workspace' ? <span>by {displayName(members[w.ownerId])}</span> : <span>never run</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {creating && <CreateModal workspaceId={workspaceId} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); onOpen(id); }} />}
    </div>
  );
}

function CreateModal({ workspaceId, onClose, onCreated }: { workspaceId: string; onClose(): void; onCreated(id: string): void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { wfApi.templates(workspaceId).then((r) => setTemplates(r.templates)).catch(() => {}); }, [workspaceId]);

  async function create(body: any) {
    setBusy(true); setError(null);
    try {
      const tz = -new Date().getTimezoneOffset();
      const r = await wfApi.create(workspaceId, body);
      // schedule templates: evaluate times in the creator's zone
      if (r.workflow.trigger?.type === 'schedule' && r.workflow.trigger.tzOffset == null) {
        await wfApi.update(r.workflow.id, { trigger: { ...r.workflow.trigger, tzOffset: tz } });
      }
      onCreated(r.workflow.id);
    } catch (e: any) { setError(e.message); setBusy(false); }
  }

  return (
    <Modal title="New workflow" onClose={onClose} width={640}>
      <form className="wf-inline" onSubmit={(e) => { e.preventDefault(); create({ name: name.trim() || 'Untitled workflow' }); }}>
        <input className="input grow" placeholder="Name your workflow" value={name} autoFocus maxLength={80} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-primary" disabled={busy}>Start from scratch</button>
      </form>
      <div className="wf-section-title">Or start from a template</div>
      <div className="wf-grid">
        {templates.map((t) => (
          <button key={t.id} className="wf-tile" disabled={busy} onClick={() => create({ templateId: t.id })}>
            <div className="wf-tile-head"><span className="wf-tile-emoji">{t.emoji}</span><span className="wf-tile-name">{t.name}</span></div>
            <div className="wf-tile-desc">{t.description}</div>
            <div className="wf-tile-foot">{TRIGGER_INFO[t.trigger.type].icon} {TRIGGER_INFO[t.trigger.type].label} · {countSteps(t.steps)} steps</div>
          </button>
        ))}
      </div>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

function countSteps(steps: any[]): number {
  return steps.reduce((n, s) => n + 1 + countSteps(s.then ?? []) + countSteps(s.else ?? []), 0);
}
