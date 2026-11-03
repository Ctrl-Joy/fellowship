// Vertical step canvas: trigger card, ordered steps, nested branch lists, add / move / delete.
import { useEffect, useRef, useState } from 'react';
import { useSession, displayName } from '../../store/session';
import { useConversations } from '../../store/conversations';
import {
  CONTAINER, STEP_INFO, TRIGGER_INFO, stepTitle, type ListAddr, type Step, type StepType, type Trigger,
} from './model';

export type Selection = { kind: 'trigger' } | { kind: 'step'; id: string };

interface CanvasProps {
  trigger: Trigger;
  steps: Step[];
  selection: Selection;
  onSelect(s: Selection): void;
  onAdd(addr: ListAddr, index: number, type: StepType): void;
  onMove(addr: ListAddr, index: number, dir: -1 | 1): void;
  onDelete(id: string): void;
  issuesByStep: Record<string, string[]>;
  triggerIssues: number;
  readOnly?: boolean;
}

export function StepCanvas(p: CanvasProps) {
  return (
    <div className="wf-canvas">
      <button type="button" className={`wf-node wf-node-trigger${p.selection.kind === 'trigger' ? ' selected' : ''}`} onClick={() => p.onSelect({ kind: 'trigger' })}>
        <span className="wf-node-ico">{TRIGGER_INFO[p.trigger.type].icon}</span>
        <span className="wf-node-main">
          <span className="wf-node-kicker">Trigger</span>
          <span className="wf-node-title">{TRIGGER_INFO[p.trigger.type].label}</span>
          <span className="wf-node-sum"><TriggerSummary trigger={p.trigger} /></span>
        </span>
        {p.triggerIssues > 0 && <span className="wf-node-warn" title="Needs attention">!</span>}
      </button>
      <StepList {...p} list={p.steps} addr={{ parentId: null, arm: null }} />
      <div className="wf-node-endcap">End</div>
    </div>
  );
}

function StepList(p: CanvasProps & { list: Step[]; addr: ListAddr }) {
  return (
    <div className="wf-list">
      <AddButton {...p} index={0} />
      {p.list.map((s, i) => (
        <div key={s.id} className="wf-item">
          <StepNode {...p} step={s} index={i} count={p.list.length} />
          <AddButton {...p} index={i + 1} />
        </div>
      ))}
    </div>
  );
}

function StepNode(p: CanvasProps & { step: Step; index: number; count: number; addr: ListAddr }) {
  const s = p.step;
  const info = STEP_INFO[s.type];
  const selected = p.selection.kind === 'step' && p.selection.id === s.id;
  const issues = p.issuesByStep[s.id] ?? [];
  const arms: ['then' | 'else', string][] = s.type === 'branch' ? [['then', 'Yes'], ['else', 'No']] : [['then', 'Approved'], ['else', 'Denied']];
  return (
    <div className="wf-node-wrap">
      <div className={`wf-node${selected ? ' selected' : ''}${s.type === 'end' ? ' wf-node-stop' : ''}`} role="button" tabIndex={0}
        onClick={() => p.onSelect({ kind: 'step', id: s.id })}
        onKeyDown={(e) => { if (e.key === 'Enter') p.onSelect({ kind: 'step', id: s.id }); }}>
        <span className="wf-node-ico">{info.icon}</span>
        <span className="wf-node-main">
          <span className="wf-node-kicker">{info.label} · <code>{s.id}</code></span>
          <span className="wf-node-title">{stepTitle(s)}</span>
          <span className="wf-node-sum"><StepSummary step={s} /></span>
        </span>
        {issues.length > 0 && <span className="wf-node-warn" title={issues.join('\n')}>!</span>}
        {!p.readOnly && (
          <span className="wf-node-tools" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="icon-btn" title="Move up" disabled={p.index === 0} onClick={() => p.onMove(p.addr, p.index, -1)}>↑</button>
            <button type="button" className="icon-btn" title="Move down" disabled={p.index === p.count - 1} onClick={() => p.onMove(p.addr, p.index, 1)}>↓</button>
            <button type="button" className="icon-btn" title="Delete step" onClick={() => p.onDelete(s.id)}>×</button>
          </span>
        )}
      </div>
      {CONTAINER.includes(s.type) && (
        <div className="wf-arms">
          {arms.map(([arm, label]) => (
            <div key={arm} className={`wf-arm wf-arm-${arm}`}>
              <div className="wf-arm-label">{label}</div>
              <StepList {...p} list={s[arm] ?? []} addr={{ parentId: s.id, arm }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const GROUPS = ['Messages', 'People & channels', 'Logic', 'Integrations'] as const;

function AddButton(p: CanvasProps & { addr: ListAddr; index: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (p.readOnly) return <div className="wf-connector" />;
  return (
    <div className="wf-add" ref={ref}>
      <div className="wf-connector" />
      <button type="button" className="wf-add-btn" title="Add a step here" onClick={() => setOpen((o) => !o)}>+</button>
      {open && (
        <div className="wf-add-menu">
          {GROUPS.map((g) => (
            <div key={g}>
              <div className="wf-var-group">{g}</div>
              {(Object.keys(STEP_INFO) as StepType[]).filter((t) => STEP_INFO[t].group === g).map((t) => (
                <button type="button" key={t} className="wf-var-item" onClick={() => { setOpen(false); p.onAdd(p.addr, p.index, t); }}>
                  <span>{STEP_INFO[t].icon} {STEP_INFO[t].label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChannelLabel({ id }: { id?: string }) {
  const c = useConversations((s) => (id ? s.byId[id] : undefined));
  if (!id) return <i>no channel yet</i>;
  if (id.includes('{{')) return <code>{id}</code>;
  return <>{c ? `#${c.name}` : 'a channel'}</>;
}

function PersonLabel({ id }: { id?: string }) {
  const m = useSession((s) => (id ? s.members[id] : undefined));
  if (!id) return <i>nobody yet</i>;
  if (id.includes('{{')) return <code>{id}</code>;
  return <>{displayName(m)}</>;
}

function TargetLabel({ t }: { t: any }) {
  switch (t?.kind) {
    case 'channel': return <ChannelLabel id={t.channelId} />;
    case 'user': return <PersonLabel id={t.userId} />;
    case 'trigger_user': return <>the person who started it</>;
    case 'trigger_channel': return <>the trigger channel</>;
    default: return <i>somewhere</i>;
  }
}

const clip = (s: string, n = 60) => (s && s.length > n ? `${s.slice(0, n)}…` : s);

function TriggerSummary({ trigger: t }: { trigger: Trigger }) {
  switch (t.type) {
    case 'manual': return <>{t.channelIds?.length ? <>in {t.channelIds.map((id, i) => <span key={id}>{i ? ', ' : ''}<ChannelLabel id={id} /></span>)}</> : 'in any conversation'}</>;
    case 'reaction': return <>{t.emoji || '?'} in <ChannelLabel id={t.channelId} /></>;
    case 'member_joined': return <>joins <ChannelLabel id={t.channelId} /></>;
    case 'message': return <>in <ChannelLabel id={t.channelId} /> {t.match === 'any' ? '(any message)' : `${t.match === 'regex' ? 'matching' : 'containing'} “${clip(t.pattern ?? '', 30)}”`}</>;
    case 'schedule': {
      const s = t.schedule;
      if (!s) return <>no schedule</>;
      if (s.kind === 'once') return <>once at {new Date(s.at).toLocaleString()}</>;
      if (s.kind === 'daily') return <>every day at {s.time}</>;
      if (s.kind === 'weekly') return <>{s.days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')} at {s.time}</>;
      return <>cron <code>{s.expr}</code></>;
    }
    case 'webhook': return <>POST JSON to the workflow URL</>;
  }
}

function StepSummary({ step: s }: { step: Step }) {
  const c = s.config;
  switch (s.type) {
    case 'send_message': return <>to <TargetLabel t={c.target} />: {clip(c.text) || <i>empty</i>}</>;
    case 'send_form': return <>“{clip(c.title, 40) || 'untitled'}” · {(c.fields ?? []).length} question(s) to <TargetLabel t={c.target} /></>;
    case 'request_approval': return <>from {c.approver?.kind === 'user' ? <PersonLabel id={c.approver.userId} /> : c.approver?.kind === 'trigger_user' ? 'the person who started it' : <code>{c.approver?.value || '?'}</code>}</>;
    case 'add_reaction': return <>{c.emoji} on <code>{clip(c.messageId, 30)}</code></>;
    case 'create_channel': return <>#{clip(c.name, 40) || '?'}{c.isPrivate ? ' (private)' : ''}</>;
    case 'invite_to_channel': return <>{(c.userIds ?? []).length} person(s) to <ChannelLabel id={c.channelId} /></>;
    case 'update_topic': return <><ChannelLabel id={c.channelId} />: {clip(c.topic, 40)}</>;
    case 'delay': return c.mode === 'until' ? <>until {clip(c.at, 40) || '?'}</> : <>{c.amount} {c.unit}</>;
    case 'http_request': return <>{c.method} {clip(c.url, 50)}</>;
    case 'set_variable': return <><code>{`vars.${c.name}`}</code> = {clip(String(c.value ?? ''), 40)}</>;
    case 'branch': {
      const n = (c.groups ?? []).reduce((a: number, g: any) => a + (g.conditions?.length ?? 0), 0);
      return <>{n} condition{n === 1 ? '' : 's'} ({c.match === 'any' ? 'any group' : 'all groups'})</>;
    }
    case 'end': return <>stop the workflow</>;
  }
}
