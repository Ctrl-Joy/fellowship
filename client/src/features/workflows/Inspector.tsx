// Right-hand configuration panels for the trigger and each step type.
import type { ReactNode } from 'react';
import { useConversations } from '../../store/conversations';
import {
  FIELD_TYPES, STEP_INFO, TRIGGER_INFO, type FormField, type Step, type Trigger, type TriggerType, type VarOption,
} from './model';
import { ChannelOrVar, ChannelSelect, PersonSelect, VarInput } from './fields';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field wf-field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </div>
  );
}

function toLocalInput(ms: number | undefined) {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TriggerInspector({ trigger, onChange, webhookPath, onRotate, readOnly }: {
  trigger: Trigger; onChange(t: Trigger): void; webhookPath?: string; onRotate(): void; readOnly?: boolean;
}) {
  const set = (patch: Partial<Trigger>) => onChange({ ...trigger, ...patch });
  const switchType = (type: TriggerType) => {
    const tz = -new Date().getTimezoneOffset();
    const base: Record<TriggerType, Trigger> = {
      manual: { type, channelIds: [] },
      reaction: { type, channelId: '', emoji: '👀' },
      member_joined: { type, channelId: '' },
      message: { type, channelId: '', match: 'contains', pattern: '' },
      schedule: { type, schedule: { kind: 'daily', time: '09:00' }, tzOffset: tz },
      webhook: { type },
    };
    onChange(base[type]);
  };
  const s = trigger.schedule;
  return (
    <fieldset className="wf-inspector" disabled={readOnly}>
      <h3>Starts when…</h3>
      <div className="wf-trigger-grid">
        {(Object.keys(TRIGGER_INFO) as TriggerType[]).map((t) => (
          <button type="button" key={t} className={`wf-trigger-opt${trigger.type === t ? ' active' : ''}`} onClick={() => trigger.type !== t && switchType(t)}>
            <span className="wf-trigger-ico">{TRIGGER_INFO[t].icon}</span>
            <b>{TRIGGER_INFO[t].label}</b>
            <small>{TRIGGER_INFO[t].hint}</small>
          </button>
        ))}
      </div>

      {trigger.type === 'manual' && (
        <Row label="Offer the shortcut in" hint="Leave empty to offer it in every conversation.">
          <div className="wf-chips">
            {(trigger.channelIds ?? []).map((id) => (
              <span key={id} className="chip"><ChannelName id={id} /><button type="button" className="icon-btn" onClick={() => set({ channelIds: trigger.channelIds!.filter((x) => x !== id) })}>×</button></span>
            ))}
          </div>
          <ChannelSelect value="" placeholder="Add a channel…" onChange={(v) => v && !(trigger.channelIds ?? []).includes(v) && set({ channelIds: [...(trigger.channelIds ?? []), v] })} />
        </Row>
      )}
      {(trigger.type === 'reaction' || trigger.type === 'member_joined' || trigger.type === 'message') && (
        <Row label="Channel"><ChannelSelect value={trigger.channelId ?? ''} onChange={(v) => set({ channelId: v })} /></Row>
      )}
      {trigger.type === 'reaction' && (
        <Row label="Emoji" hint="Paste or type the emoji people react with.">
          <input className="input wf-emoji-input" value={trigger.emoji ?? ''} onChange={(e) => set({ emoji: e.target.value.trim() })} />
        </Row>
      )}
      {trigger.type === 'message' && (
        <>
          <Row label="Match">
            <select className="input" value={trigger.match ?? 'contains'} onChange={(e) => set({ match: e.target.value as any })}>
              <option value="contains">Message contains text</option>
              <option value="regex">Message matches a regular expression</option>
              <option value="any">Any message</option>
            </select>
          </Row>
          {(trigger.match ?? 'contains') !== 'any' && (
            <Row label={trigger.match === 'regex' ? 'Pattern' : 'Text'} hint={trigger.match === 'regex' ? 'Case-insensitive JavaScript regular expression.' : 'Case-insensitive.'}>
              <input className="input" value={trigger.pattern ?? ''} onChange={(e) => set({ pattern: e.target.value })} />
            </Row>
          )}
          <small className="muted">Messages sent by this workflow never restart it.</small>
        </>
      )}
      {trigger.type === 'schedule' && s && (
        <>
          <Row label="Repeat">
            <select className="input" value={s.kind} onChange={(e) => {
              const k = e.target.value;
              set({ schedule: k === 'once' ? { kind: 'once', at: Date.now() + 3600_000 } : k === 'daily' ? { kind: 'daily', time: '09:00' }
                : k === 'weekly' ? { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' } : { kind: 'cron', expr: '0 9 * * 1-5' } });
            }}>
              <option value="once">Once</option><option value="daily">Every day</option>
              <option value="weekly">Every week on…</option><option value="cron">Custom (cron)</option>
            </select>
          </Row>
          {s.kind === 'once' && (
            <Row label="Date and time">
              <input className="input" type="datetime-local" value={toLocalInput(s.at)} onChange={(e) => set({ schedule: { kind: 'once', at: new Date(e.target.value).getTime() } })} />
            </Row>
          )}
          {s.kind === 'weekly' && (
            <Row label="Days">
              <div className="wf-days">
                {DAYS.map((d, i) => (
                  <button type="button" key={d} className={s.days.includes(i) ? 'active' : ''}
                    onClick={() => set({ schedule: { ...s, days: s.days.includes(i) ? s.days.filter((x) => x !== i) : [...s.days, i].sort() } })}>{d}</button>
                ))}
              </div>
            </Row>
          )}
          {(s.kind === 'daily' || s.kind === 'weekly') && (
            <Row label="Time">
              <input className="input" type="time" value={s.time} onChange={(e) => set({ schedule: { ...s, time: e.target.value } })} />
            </Row>
          )}
          {s.kind === 'cron' && (
            <Row label="Cron expression" hint="minute hour day-of-month month day-of-week — e.g. */15 9-17 * * MON-FRI">
              <input className="input wf-mono" value={s.expr} onChange={(e) => set({ schedule: { kind: 'cron', expr: e.target.value } })} />
            </Row>
          )}
          {s.kind !== 'once' && (
            <small className="muted">Times use UTC{(trigger.tzOffset ?? 0) >= 0 ? '+' : '−'}{fmtOffset(trigger.tzOffset ?? 0)} (your browser when you picked the trigger). <button type="button" className="link" onClick={() => set({ tzOffset: -new Date().getTimezoneOffset() })}>Use my time zone</button></small>
          )}
        </>
      )}
      {trigger.type === 'webhook' && (
        <Row label="Webhook URL" hint={<>POST a JSON object; its fields become <code>{'{{trigger.webhook.<field>}}'}</code>. Keep the URL secret.</>}>
          {webhookPath ? <code className="wf-code-block">{location.origin}{webhookPath}</code> : <small className="muted">Save the workflow to get a URL.</small>}
          {webhookPath && <button type="button" className="btn btn-sm" onClick={onRotate}>Generate a new URL</button>}
        </Row>
      )}
    </fieldset>
  );
}

function fmtOffset(min: number) {
  const a = Math.abs(min);
  return `${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`;
}

function ChannelName({ id }: { id: string }) {
  const c = useConversations((s) => s.byId[id]);
  return <>{c ? `#${c.name}` : 'unknown channel'}</>;
}

// ------------------------------------------------------------------ steps

function TargetPicker({ value, onChange, vars, triggerType, label = 'Send to' }: {
  value: any; onChange(v: any): void; vars: VarOption[]; triggerType: TriggerType; label?: string;
}) {
  const kind = value?.kind ?? 'channel';
  const hasTriggerUser = !['schedule', 'webhook'].includes(triggerType);
  const hasTriggerChannel = ['manual', 'reaction', 'member_joined', 'message'].includes(triggerType);
  return (
    <Row label={label}>
      <select className="input" value={kind} onChange={(e) => {
        const k = e.target.value;
        onChange(k === 'channel' ? { kind: k, channelId: '' } : k === 'user' ? { kind: k, userId: '' } : { kind: k });
      }}>
        <option value="channel">A channel</option>
        <option value="user">A person (direct message)</option>
        {hasTriggerUser && <option value="trigger_user">The person who started the workflow</option>}
        {hasTriggerChannel && <option value="trigger_channel">The channel where it started</option>}
      </select>
      {kind === 'channel' && <ChannelOrVar value={value.channelId ?? ''} vars={vars} onChange={(v) => onChange({ kind, channelId: v })} />}
      {kind === 'user' && <PersonOrVar value={value.userId ?? ''} vars={vars} onChange={(v) => onChange({ kind, userId: v })} />}
    </Row>
  );
}

function PersonOrVar({ value, onChange, vars }: { value: string; onChange(v: string): void; vars: VarOption[] }) {
  const isVar = (value ?? '').includes('{{');
  return (
    <div className="wf-stack">
      {!isVar && <PersonSelect value={value} onChange={onChange} />}
      {isVar && <VarInput value={value} onChange={onChange} vars={vars} />}
      <button type="button" className="link wf-small-link" onClick={() => onChange(isVar ? '' : '{{trigger.user}}')}>{isVar ? 'Pick a person instead' : 'Use a variable instead'}</button>
    </div>
  );
}

export function StepInspector({ step, onChange, vars, triggerType, issues, readOnly }: {
  step: Step; onChange(s: Step): void; vars: VarOption[]; triggerType: TriggerType; issues: string[]; readOnly?: boolean;
}) {
  const c = step.config;
  const set = (patch: Record<string, any>) => onChange({ ...step, config: { ...c, ...patch } });
  const info = STEP_INFO[step.type];
  return (
    <fieldset className="wf-inspector" disabled={readOnly}>
      <h3>{info.icon} {info.label}</h3>
      {issues.length > 0 && <ul className="wf-issues">{issues.map((i, n) => <li key={n}>{i}</li>)}</ul>}
      <Row label="Step name" hint={<>Refer to outputs as <code>{`{{steps.${step.id}.…}}`}</code></>}>
        <input className="input" value={step.name ?? ''} placeholder={info.label} maxLength={80} onChange={(e) => onChange({ ...step, name: e.target.value })} />
      </Row>

      {step.type === 'send_message' && (
        <>
          <TargetPicker value={c.target} onChange={(target) => set({ target })} vars={vars} triggerType={triggerType} />
          <Row label="Message" hint="People and channels in variables appear as mentions."><VarInput multiline rows={5} value={c.text} onChange={(text) => set({ text })} vars={vars} /></Row>
        </>
      )}

      {step.type === 'send_form' && (
        <>
          <TargetPicker value={c.target} onChange={(target) => set({ target })} vars={vars} triggerType={triggerType} label="Post the form to" />
          <Row label="Title"><VarInput value={c.title} onChange={(title) => set({ title })} vars={vars} /></Row>
          <Row label="Intro (optional)"><VarInput multiline rows={2} value={c.intro} onChange={(intro) => set({ intro })} vars={vars} /></Row>
          <FieldsEditor fields={c.fields ?? []} onChange={(fields) => set({ fields })} />
          <Row label="Submit button label"><input className="input" value={c.submitLabel ?? ''} placeholder="Submit" onChange={(e) => set({ submitLabel: e.target.value })} /></Row>
          <label className="wf-check"><input type="checkbox" checked={!!c.allowMultiple} onChange={(e) => set({ allowMultiple: e.target.checked })} /> Let people submit more than once</label>
          <Row label="Post responses" hint="The workflow continues after the first response; later responses are still recorded.">
            <select className="input" value={c.postResponsesTo === 'same' ? 'same' : c.postResponsesTo ? 'channel' : ''} onChange={(e) => set({ postResponsesTo: e.target.value === 'same' ? 'same' : e.target.value === 'channel' ? (c.postResponsesTo && c.postResponsesTo !== 'same' ? c.postResponsesTo : '') : '' })}>
              <option value="">Don't post responses</option>
              <option value="same">In a thread on the form</option>
              <option value="channel">To a channel…</option>
            </select>
            {c.postResponsesTo !== 'same' && c.postResponsesTo !== '' && c.postResponsesTo != null && (
              <ChannelSelect value={c.postResponsesTo} onChange={(v) => set({ postResponsesTo: v })} />
            )}
          </Row>
        </>
      )}

      {step.type === 'request_approval' && (
        <>
          <Row label="Approver">
            <select className="input" value={c.approver?.kind ?? 'user'} onChange={(e) => {
              const k = e.target.value;
              set({ approver: k === 'user' ? { kind: k, userId: '' } : k === 'variable' ? { kind: k, value: '' } : { kind: k } });
            }}>
              <option value="user">A specific person</option>
              <option value="variable">A person chosen earlier (e.g. in a form)</option>
              {!['schedule', 'webhook'].includes(triggerType) && <option value="trigger_user">The person who started the workflow</option>}
            </select>
            {c.approver?.kind === 'user' && <PersonSelect value={c.approver.userId ?? ''} onChange={(v) => set({ approver: { kind: 'user', userId: v } })} />}
            {c.approver?.kind === 'variable' && <VarInput value={c.approver.value ?? ''} onChange={(v) => set({ approver: { kind: 'variable', value: v } })} vars={vars} placeholder="{{steps.form1.manager}}" />}
          </Row>
          <Row label="Request" hint="Sent as a direct message to the approver unless you pick a channel."><VarInput multiline value={c.text} onChange={(text) => set({ text })} vars={vars} /></Row>
          <Row label="Post in a channel instead (optional)"><ChannelSelect value={c.channelId ?? ''} placeholder="Direct message to the approver" onChange={(v) => set({ channelId: v || undefined })} /></Row>
          <small className="muted">Add steps under <b>Approved</b> and <b>Denied</b> on the canvas.</small>
        </>
      )}

      {step.type === 'add_reaction' && (
        <>
          <Row label="Message" hint="Usually the message that started the workflow."><VarInput value={c.messageId} onChange={(messageId) => set({ messageId })} vars={vars} /></Row>
          <Row label="Emoji"><input className="input wf-emoji-input" value={c.emoji ?? ''} onChange={(e) => set({ emoji: e.target.value.trim() })} /></Row>
        </>
      )}

      {step.type === 'create_channel' && (
        <>
          <Row label="Channel name" hint="Lower-cased; spaces become hyphens. Created on behalf of the workflow owner."><VarInput value={c.name} onChange={(name) => set({ name })} vars={vars} /></Row>
          <Row label="Topic (optional)"><VarInput value={c.topic} onChange={(topic) => set({ topic })} vars={vars} /></Row>
          <label className="wf-check"><input type="checkbox" checked={!!c.isPrivate} onChange={(e) => set({ isPrivate: e.target.checked })} /> Private channel</label>
        </>
      )}

      {step.type === 'invite_to_channel' && (
        <>
          <Row label="Channel"><ChannelOrVar value={c.channelId ?? ''} vars={vars} onChange={(channelId) => set({ channelId })} /></Row>
          <Row label="People">
            {(c.userIds ?? []).map((u: string, i: number) => (
              <div key={i} className="wf-inline">
                <PersonOrVar value={u} vars={vars} onChange={(v) => set({ userIds: c.userIds.map((x: string, j: number) => (j === i ? v : x)) })} />
                <button type="button" className="icon-btn" title="Remove" onClick={() => set({ userIds: c.userIds.filter((_: any, j: number) => j !== i) })}>×</button>
              </div>
            ))}
            <button type="button" className="btn btn-sm" onClick={() => set({ userIds: [...(c.userIds ?? []), ''] })}>Add person</button>
          </Row>
        </>
      )}

      {step.type === 'update_topic' && (
        <>
          <Row label="Channel"><ChannelOrVar value={c.channelId ?? ''} vars={vars} onChange={(channelId) => set({ channelId })} /></Row>
          <Row label="New topic"><VarInput value={c.topic} onChange={(topic) => set({ topic })} vars={vars} /></Row>
        </>
      )}

      {step.type === 'delay' && (
        <>
          <Row label="Wait">
            <select className="input" value={c.mode ?? 'duration'} onChange={(e) => set(e.target.value === 'until' ? { mode: 'until', at: '' } : { mode: 'duration', amount: 1, unit: 'hours' })}>
              <option value="duration">For a length of time</option>
              <option value="until">Until a date and time</option>
            </select>
          </Row>
          {c.mode === 'until' ? (
            <Row label="Continue at" hint="A date/time, or a variable holding one (e.g. a form date).">
              <input className="input" type="datetime-local" value={/^\d{4}-/.test(c.at ?? '') ? toLocalInput(Date.parse(c.at)) : ''} onChange={(e) => set({ at: new Date(e.target.value).toISOString() })} />
              <VarInput value={c.at ?? ''} onChange={(at) => set({ at })} vars={vars} />
            </Row>
          ) : (
            <div className="wf-inline">
              <input className="input" type="number" min={1} value={c.amount} onChange={(e) => set({ amount: Number(e.target.value) })} />
              <select className="input" value={c.unit} onChange={(e) => set({ unit: e.target.value })}>
                <option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option>
              </select>
            </div>
          )}
        </>
      )}

      {step.type === 'http_request' && (
        <>
          <div className="wf-inline">
            <select className="input wf-method" value={c.method} onChange={(e) => set({ method: e.target.value })}>
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
            </select>
            <div className="grow"><VarInput value={c.url} onChange={(url) => set({ url })} vars={vars} placeholder="https://example.com/hook" /></div>
          </div>
          <Row label="Headers">
            {(c.headers ?? []).map((h: any, i: number) => (
              <div key={i} className="wf-inline">
                <input className="input" placeholder="Header" value={h.key} onChange={(e) => set({ headers: c.headers.map((x: any, j: number) => (j === i ? { ...x, key: e.target.value } : x)) })} />
                <div className="grow"><VarInput value={h.value} onChange={(v) => set({ headers: c.headers.map((x: any, j: number) => (j === i ? { ...x, value: v } : x)) })} vars={vars} /></div>
                <button type="button" className="icon-btn" onClick={() => set({ headers: c.headers.filter((_: any, j: number) => j !== i) })}>×</button>
              </div>
            ))}
            <button type="button" className="btn btn-sm" onClick={() => set({ headers: [...(c.headers ?? []), { key: '', value: '' }] })}>Add header</button>
          </Row>
          {c.method !== 'GET' && <Row label="Body" hint="JSON is sent as application/json."><VarInput multiline rows={5} value={c.body} onChange={(body) => set({ body })} vars={vars} /></Row>}
          <label className="wf-check"><input type="checkbox" checked={!!c.failOnError} onChange={(e) => set({ failOnError: e.target.checked })} /> Fail the workflow if the server answers with an error status</label>
          <small className="muted">Times out after 10 seconds. Only http(s) URLs; private network addresses are blocked.</small>
        </>
      )}

      {step.type === 'set_variable' && (
        <>
          <Row label="Variable name" hint={<>Use it later as <code>{`{{vars.${c.name || 'name'}}}`}</code></>}>
            <input className="input" value={c.name} onChange={(e) => set({ name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })} />
          </Row>
          <Row label="Value"><VarInput value={c.value} onChange={(value) => set({ value })} vars={vars} /></Row>
        </>
      )}

      {step.type === 'branch' && <BranchEditor config={c} onChange={(cfg) => onChange({ ...step, config: cfg })} vars={vars} />}

      {step.type === 'end' && <p className="muted">The run stops here and is marked as succeeded.</p>}
    </fieldset>
  );
}

function FieldsEditor({ fields, onChange }: { fields: FormField[]; onChange(f: FormField[]): void }) {
  const upd = (i: number, patch: Partial<FormField>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const used = new Set(fields.map((f) => f.id));
  const nextId = () => { for (let n = 1; ; n++) if (!used.has(`q${n}`)) return `q${n}`; };
  return (
    <div className="field wf-field">
      <span>Questions</span>
      {fields.map((f, i) => (
        <div key={i} className="wf-qcard">
          <div className="wf-inline">
            <input className="input grow" placeholder="Question" value={f.label} onChange={(e) => upd(i, { label: e.target.value })} />
            <select className="input" value={f.type} onChange={(e) => upd(i, { type: e.target.value as any, options: ['select', 'multi_select'].includes(e.target.value) ? (f.options?.length ? f.options : ['Option 1']) : undefined })}>
              {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="wf-inline wf-qmeta">
            <label className="wf-check"><input type="checkbox" checked={!!f.required} onChange={(e) => upd(i, { required: e.target.checked })} /> Required</label>
            <span className="muted">id</span>
            <input className="input wf-mono wf-qid" value={f.id} onChange={(e) => upd(i, { id: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })} />
            <span className="grow" />
            <button type="button" className="icon-btn" disabled={i === 0} title="Move up" onClick={() => { const n = [...fields]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }}>↑</button>
            <button type="button" className="icon-btn" title="Remove" onClick={() => onChange(fields.filter((_, j) => j !== i))}>×</button>
          </div>
          {(f.type === 'select' || f.type === 'multi_select') && (
            <textarea className="input" rows={3} placeholder="One option per line" value={(f.options ?? []).join('\n')}
              onChange={(e) => upd(i, { options: e.target.value.split('\n') })} />
          )}
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={() => onChange([...fields, { id: nextId(), label: '', type: 'short_text', required: false }])}>Add question</button>
    </div>
  );
}

const OPS: [string, string][] = [['equals', 'equals'], ['not_equals', 'does not equal'], ['contains', 'contains'], ['gt', 'is greater than'], ['lt', 'is less than'], ['is_empty', 'is empty'], ['not_empty', 'is not empty']];

function BranchEditor({ config, onChange, vars }: { config: any; onChange(c: any): void; vars: VarOption[] }) {
  const groups: any[] = config.groups ?? [];
  const setGroups = (g: any[]) => onChange({ ...config, groups: g });
  const updGroup = (gi: number, patch: any) => setGroups(groups.map((g, j) => (j === gi ? { ...g, ...patch } : g)));
  return (
    <div className="wf-branch-edit">
      <Row label="Go down the “Yes” path when">
        <select className="input" value={config.match ?? 'all'} onChange={(e) => onChange({ ...config, match: e.target.value })}>
          <option value="all">all groups match (AND)</option>
          <option value="any">any group matches (OR)</option>
        </select>
      </Row>
      {groups.map((g, gi) => (
        <div key={gi} className="wf-cond-group">
          <div className="wf-inline">
            <b className="grow">Group {gi + 1}</b>
            <select className="input" value={g.match} onChange={(e) => updGroup(gi, { match: e.target.value })}>
              <option value="all">all of (AND)</option><option value="any">any of (OR)</option>
            </select>
            <button type="button" className="icon-btn" title="Remove group" onClick={() => setGroups(groups.filter((_, j) => j !== gi))}>×</button>
          </div>
          {(g.conditions ?? []).map((cond: any, ci: number) => {
            const updCond = (patch: any) => updGroup(gi, { conditions: g.conditions.map((x: any, j: number) => (j === ci ? { ...x, ...patch } : x)) });
            return (
              <div key={ci} className="wf-cond">
                <VarInput value={cond.left} onChange={(left) => updCond({ left })} vars={vars} placeholder="{{steps.form1.answer}}" />
                <div className="wf-inline">
                  <select className="input" value={cond.op} onChange={(e) => updCond({ op: e.target.value })}>
                    {OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  {!['is_empty', 'not_empty'].includes(cond.op) && <div className="grow"><VarInput value={cond.right ?? ''} onChange={(right) => updCond({ right })} vars={vars} placeholder="value" /></div>}
                  <button type="button" className="icon-btn" title="Remove condition" onClick={() => updGroup(gi, { conditions: g.conditions.filter((_: any, j: number) => j !== ci) })}>×</button>
                </div>
              </div>
            );
          })}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => updGroup(gi, { conditions: [...(g.conditions ?? []), { left: '', op: 'equals', right: '' }] })}>+ Condition</button>
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={() => setGroups([...groups, { match: 'all', conditions: [{ left: '', op: 'equals', right: '' }] }])}>Add condition group</button>
    </div>
  );
}
