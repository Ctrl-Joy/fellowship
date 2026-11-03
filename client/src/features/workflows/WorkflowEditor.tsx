import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConversations } from '../../store/conversations';
import { formatFull } from '../../lib/time';
import {
  defaultConfig, editList, findStep, newStepId, removeStep, updateStep, variablesFor, wfApi,
  type Issue, type ListAddr, type Step, type StepType, type Trigger, type Workflow,
} from './model';
import { StepCanvas, type Selection } from './StepCanvas';
import { StepInspector, TriggerInspector } from './Inspector';
import { RunHistory, StatusPill } from './RunHistory';
import './workflows.css';

const EMOJIS = ['⚡', '👋', '☀️', '🌴', '🚨', '📝', '✅', '📣', '🎉', '🔔', '🧭', '🤖'];

export function WorkflowEditor({ id, onBack }: { id: string; onBack(): void }) {
  const [wf, setWf] = useState<Workflow | null>(null);
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [meta, setMeta] = useState({ name: '', description: '', emoji: '⚡' });
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selection, setSelection] = useState<Selection>({ kind: 'trigger' });
  const [tab, setTab] = useState<'build' | 'runs'>('build');
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const dirtyRef = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const activeConv = useConversations((s) => s.activeId);

  useEffect(() => {
    wfApi.get(id).then((r) => {
      setWf(r.workflow); setTrigger(r.workflow.trigger!); setSteps(r.workflow.steps ?? []);
      setMeta({ name: r.workflow.name, description: r.workflow.description, emoji: r.workflow.emoji });
      setIssues(r.issues ?? []);
    }).catch((e) => setError(e.message));
  }, [id]);

  const readOnly = !wf?.canEdit;

  const save = useCallback(async () => {
    if (!wf || !trigger || !dirtyRef.current) return wf;
    dirtyRef.current = false;
    setSaveState('saving');
    try {
      const r = await wfApi.update(wf.id, { ...meta, name: meta.name.trim() || 'Untitled workflow', trigger, steps });
      setWf(r.workflow); setIssues(r.issues);
      setSaveState(dirtyRef.current ? 'dirty' : 'saved');
      return r.workflow;
    } catch (e: any) {
      setSaveState('error'); setError(e.message); dirtyRef.current = true;
      return null;
    }
  }, [wf, trigger, steps, meta]);

  // Autosave shortly after edits.
  useEffect(() => {
    if (saveState !== 'dirty') return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void save(); }, 700);
    return () => window.clearTimeout(timer.current);
  }, [saveState, save, trigger, steps, meta]);

  const touch = () => { dirtyRef.current = true; setSaveState('dirty'); setMessage(null); setError(null); };
  const changeSteps = (fn: (s: Step[]) => Step[]) => { setSteps((s) => fn(s)); touch(); };

  const issuesByStep = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const i of issues) if (i.stepId) (m[i.stepId] ??= []).push(i.message);
    return m;
  }, [issues]);
  const triggerIssues = issues.filter((i) => !i.stepId);

  if (error && !wf) return <div className="view"><div className="empty">{error} <button className="link" onClick={onBack}>Back</button></div></div>;
  if (!wf || !trigger) return <div className="view"><div className="empty">Loading workflow…</div></div>;

  const selectedStep = selection.kind === 'step' ? findStep(steps, selection.id) : null;

  function addStep(addr: ListAddr, index: number, type: StepType) {
    const step: Step = { id: newStepId(steps, type), type, config: defaultConfig(type) };
    if (type === 'branch' || type === 'request_approval') { step.then = []; step.else = []; }
    changeSteps((s) => editList(s, addr, (list) => [...list.slice(0, index), step, ...list.slice(index)]));
    setSelection({ kind: 'step', id: step.id });
  }

  function moveStep(addr: ListAddr, index: number, dir: -1 | 1) {
    changeSteps((s) => editList(s, addr, (list) => {
      const n = [...list]; const j = index + dir;
      if (j < 0 || j >= n.length) return list;
      [n[index], n[j]] = [n[j], n[index]];
      return n;
    }));
  }

  async function act(fn: () => Promise<any>, ok?: string) {
    setError(null); setMessage(null);
    try {
      await save();
      await fn();
      if (ok) setMessage(ok);
    } catch (e: any) {
      setError(e.message);
      const fresh = await wfApi.get(wf!.id).catch(() => null);
      if (fresh?.issues) setIssues(fresh.issues);
    }
  }

  const publish = () => act(async () => { const r = await wfApi.publish(wf.id); setWf(r.workflow); }, 'Published — the workflow is live.');
  const unpublish = () => act(async () => { const r = await wfApi.unpublish(wf.id); setWf(r.workflow); }, 'Unpublished. Running instances finish normally.');
  const testRun = () => act(async () => {
    await wfApi.run(wf.id, { test: true, conversationId: activeConv ?? undefined });
    setTab('runs');
  }, 'Test run started.');
  const remove = async () => {
    if (!confirm(`Delete “${wf.name}”? Its run history is removed too.`)) return;
    try { await wfApi.remove(wf.id); onBack(); } catch (e: any) { setError(e.message); }
  };

  const vars = selectedStep ? variablesFor(trigger, steps, selectedStep.id) : [];

  return (
    <div className="wf-editor">
      <div className="wf-editor-head">
        <button className="btn btn-ghost btn-sm" onClick={async () => { await save(); onBack(); }}>← All workflows</button>
        <div className="wf-varpicker">
          <button className="wf-emoji-btn" disabled={readOnly} onClick={() => setEmojiOpen((o) => !o)}>{meta.emoji || '⚡'}</button>
          {emojiOpen && (
            <div className="wf-var-menu" style={{ left: 0, right: 'auto', width: 200 }}>
              <div className="wf-days">{EMOJIS.map((e) => <button key={e} onClick={() => { setMeta((m) => ({ ...m, emoji: e })); setEmojiOpen(false); touch(); }}>{e}</button>)}</div>
            </div>
          )}
        </div>
        <input className="wf-name" value={meta.name} disabled={readOnly} maxLength={80} aria-label="Workflow name"
          onChange={(e) => { setMeta((m) => ({ ...m, name: e.target.value })); touch(); }} />
        <span className={`wf-pill ${wf.status === 'published' ? 'wf-pill-ok' : 'wf-pill-muted'}`}>{wf.status === 'published' ? 'Published' : 'Draft'}</span>
        {wf.hasUnpublishedChanges && <span className="wf-pill wf-pill-wait">Unpublished changes</span>}
        <span className="wf-save-state">{saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Unsaved' : saveState === 'error' ? 'Not saved' : 'Saved'}</span>
        <div className="wf-tabs">
          <button className={tab === 'build' ? 'active' : ''} onClick={() => setTab('build')}>Build</button>
          <button className={tab === 'runs' ? 'active' : ''} onClick={() => setTab('runs')}>Runs</button>
        </div>
        {!readOnly && (
          <>
            <button className="btn btn-sm" onClick={testRun} title={activeConv ? 'Runs the current draft as you, in your last open conversation' : 'Runs the current draft as you'}>Test run</button>
            {wf.status === 'published' && <button className="btn btn-sm" onClick={unpublish}>Unpublish</button>}
            <button className="btn btn-sm btn-primary" onClick={publish} disabled={issues.length > 0} title={issues.length ? 'Fix the highlighted problems first' : ''}>
              {wf.status === 'published' ? (wf.hasUnpublishedChanges ? 'Publish changes' : 'Republish') : 'Publish'}
            </button>
            <button className="btn btn-sm btn-danger-ghost" onClick={remove}>Delete</button>
          </>
        )}
      </div>
      {tab === 'build' ? (
        <div className="wf-editor-body">
          <div className="wf-editor-main">
            {message && <div className="wf-issue-bar" style={{ background: 'var(--brand-soft)' }}>{message}</div>}
            {error && <div className="wf-issue-bar" style={{ background: 'var(--mention-soft)' }}>{error}</div>}
            {issues.length > 0 && !readOnly && (
              <div className="wf-issue-bar">
                <b>{issues.length} thing{issues.length === 1 ? '' : 's'} to fix before publishing</b>
                <ul>{issues.slice(0, 8).map((i, n) => (
                  <li key={n} onClick={() => setSelection(i.stepId ? { kind: 'step', id: i.stepId } : { kind: 'trigger' })}>
                    {i.stepId ? <code>{i.stepId}</code> : 'Trigger'}: {i.message}
                  </li>
                ))}</ul>
              </div>
            )}
            {wf.nextRunAt && wf.status === 'published' && <div className="muted" style={{ marginBottom: 10 }}>Next scheduled run: {formatFull(wf.nextRunAt)}</div>}
            <textarea className="input" rows={2} placeholder="Describe what this workflow does (optional)" value={meta.description} disabled={readOnly}
              style={{ width: 320, display: 'block', margin: '0 auto 14px' }}
              onChange={(e) => { setMeta((m) => ({ ...m, description: e.target.value })); touch(); }} />
            <StepCanvas trigger={trigger} steps={steps} selection={selection} onSelect={setSelection}
              onAdd={addStep} onMove={moveStep} readOnly={readOnly}
              onDelete={(sid) => { changeSteps((s) => removeStep(s, sid)); setSelection({ kind: 'trigger' }); }}
              issuesByStep={issuesByStep} triggerIssues={triggerIssues.length} />
          </div>
          <aside className="wf-editor-side">
            {selection.kind === 'trigger' || !selectedStep ? (
              <TriggerInspector trigger={trigger} readOnly={readOnly} webhookPath={wf.webhookPath}
                onChange={(t) => { setTrigger(t); touch(); }}
                onRotate={async () => { const r = await wfApi.rotateSecret(wf.id); setWf(r.workflow); }} />
            ) : (
              <StepInspector key={selectedStep.id} step={selectedStep} vars={vars} triggerType={trigger.type} readOnly={readOnly}
                issues={issuesByStep[selectedStep.id] ?? []}
                onChange={(next) => changeSteps((s) => updateStep(s, next.id, () => next))} />
            )}
          </aside>
        </div>
      ) : (
        <div className="wf-editor-main" style={{ padding: 0 }}>
          <RunHistory workflowId={wf.id} steps={steps} />
        </div>
      )}
    </div>
  );
}

export { StatusPill };
