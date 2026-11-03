import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { User } from '../../types';
import type { Activity, Comment, ItemStatus, ItemType, Priority, WorkItem } from './types';
import { PRIORITY_LABEL, PRIORITY_ORDER, STATUS_LABEL, STATUS_ORDER, TYPE_LABEL, TYPE_ORDER } from './types';
import { projectItems, useProjects } from './store';
import { projectsApi } from './api';
import { Assignee, ItemKey, PriorityIcon, StatusPill, TypeIcon, formatDate, todayIso, useItemPanel } from './ui';
import { ConfirmDialog, Dropdown, Glyph, MemberList, MenuItem, copyText, epicColor, isOverdue, memberName, useFlash } from './kit';
import { Icon } from '../../components/Icon';
import { Avatar } from '../../components/Avatar';
import { Modal } from '../../components/Modal';
import { Markdown } from '../../lib/markdown';
import { formatFull, timeAgo } from '../../lib/time';
import { ws } from '../../ws';
import { useConversations, conversationTitle } from '../../store/conversations';
import { displayName, useSession } from '../../store/session';
import './item.css';

type Patch = Parameters<typeof projectsApi.updateItem>[1];

/**
 * Full work-item view, used by the side panel and the /projects/item/:iid page.
 * Reads the item from the store so every change (local or over WS) shows at once.
 */
export default function ItemDetail({ itemId, workspaceId, currentUser, mode, onClose }: {
  itemId: string; workspaceId: string; currentUser: User; mode: 'panel' | 'page'; onClose?(): void;
}) {
  const navigate = useNavigate();
  const item = useProjects((s) => s.items[itemId]);
  const project = useProjects((s) => (item ? s.projects[item.projectId] : undefined));
  const parent = useProjects((s) => (item?.parentId ? s.items[item.parentId] : undefined));
  const allItems = useProjects((s) => s.items);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'comments' | 'history'>('comments');
  const [sharing, setSharing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [flash, setFlash] = useFlash();

  useEffect(() => {
    let alive = true;
    setLoadErr(null);
    projectsApi.getItem(itemId).then((r) => {
      if (!alive) return;
      if (!useProjects.getState().projects[r.item.projectId]) projectsApi.getProject(r.item.projectId).catch(() => {});
      // The parent, epic and parent pickers need the rest of the space (e.g. when opened from a chat link).
      projectsApi.listItems(r.item.projectId).catch(() => {});
    }).catch((e) => { if (alive) setLoadErr(e?.status === 404 ? 'This work item does not exist or was deleted.' : (e?.message || 'Could not load the work item')); });
    return () => { alive = false; };
  }, [itemId]);

  const children = useMemo(() => Object.values(allItems).filter((i) => i.parentId === itemId).sort((a, b) => a.rank - b.rank || a.number - b.number), [allItems, itemId]);
  const epics = useMemo(() => (item ? projectItems(allItems, item.projectId).filter((i) => i.type === 'epic' && i.id !== item.id) : []), [allItems, item?.projectId, item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const openChild = (id: string) => {
    if (mode === 'page') navigate(`/w/${workspaceId}/projects/item/${id}`);
    else useItemPanel.getState().openItem(id);
  };
  const update = (body: Patch) => projectsApi.updateItem(itemId, body).then(() => setErr('')).catch((e) => setErr(e?.message || 'Could not save the change'));

  if (!item) {
    return (
      <div className={`pj-detail pj-detail-${mode}`}>
        <div className="pj-detail-top">
          <span className="grow" />
          {onClose && <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" size={18} /></button>}
        </div>
        {loadErr ? (
          <div className="pj-empty-hero">
            <h2>Work item not found</h2>
            <p className="muted">{loadErr}</p>
            <Link className="btn" to={`/w/${workspaceId}/projects`} onClick={onClose}>Go to Projects</Link>
          </div>
        ) : <div className="loading-block"><span className="spinner" /> Loading…</div>}
      </div>
    );
  }

  const link = `${location.origin}/w/${workspaceId}/projects/item/${item.id}`;
  const today = todayIso();
  const pct = item.childCount ? Math.round((item.childDone / item.childCount) * 100) : 0;

  return (
    <div className={`pj-detail pj-detail-${mode}`}>
      <div className="pj-detail-top">
        <nav className="pj-crumbs pj-detail-crumbs" aria-label="Breadcrumb">
          {project && (
            <Link to={`/w/${workspaceId}/projects/p/${project.id}`} className="pj-crumb-space">
              <span className="pj-space-icon pj-space-icon-sm" style={{ background: project.color }}>{project.iconEmoji}</span>{project.name}
            </Link>
          )}
          {parent && <><span className="pj-crumb-sep">/</span><span className="row gap-sm"><TypeIcon type={parent.type} size={14} /><ItemKey item={parent} /></span></>}
          <span className="pj-crumb-sep">/</span>
          <span className="row gap-sm"><TypeIcon type={item.type} size={14} />
            <button className="pj-key" title="Copy key" onClick={async () => { if (await copyText(item.key)) setFlash(`Copied ${item.key}`); }}>{item.key}</button>
          </span>
        </nav>
        <span className="grow" />
        {flash && <span className="pj-flash" role="status">{flash}</span>}
        <button className="pj-btn" onClick={() => setSharing(true)} title="Share to a channel or DM"><Glyph name="share" size={15} /> Share</button>
        <button className="icon-btn" title="Copy link" aria-label="Copy link" onClick={async () => { if (await copyText(link)) setFlash('Link copied'); }}><Icon name="link" size={17} /></button>
        <Dropdown className="icon-btn" ariaLabel="More actions" label={<Icon name="more" size={18} />} align="end" width={210}>
          {(close) => (
            <div className="pj-menu" role="menu">
              <MenuItem icon={<Glyph name="copy" size={15} />} onClick={async () => { close(); if (await copyText(item.key)) setFlash(`Copied ${item.key}`); }}>Copy key</MenuItem>
              <MenuItem icon={<Icon name="link" size={15} />} onClick={async () => { close(); if (await copyText(link)) setFlash('Link copied'); }}>Copy link</MenuItem>
              <MenuItem icon={<Glyph name="share" size={15} />} onClick={() => { close(); setSharing(true); }}>Share to channel</MenuItem>
              {mode === 'panel' && <MenuItem icon={<Glyph name="open" size={15} />} onClick={() => { close(); onClose?.(); navigate(`/w/${workspaceId}/projects/item/${item.id}`); }}>Open full page</MenuItem>}
              <div className="pj-menu-sep" />
              <MenuItem danger icon={<Icon name="trash" size={15} />} onClick={() => { close(); setDeleting(true); }}>Delete</MenuItem>
            </div>
          )}
        </Dropdown>
        {mode === 'panel' && (
          <>
            <button className="icon-btn" title="Open full page" aria-label="Open full page" onClick={() => { onClose?.(); navigate(`/w/${workspaceId}/projects/item/${item.id}`); }}><Glyph name="expand" size={16} /></button>
            <button className="icon-btn" title="Close (Esc)" aria-label="Close" onClick={onClose}><Icon name="x" size={18} /></button>
          </>
        )}
      </div>

      {err && <div className="form-error pj-inline-err" role="alert">{err} <button className="pj-link-btn" onClick={() => setErr('')}>Dismiss</button></div>}

      <div className="pj-detail-body">
        <div className="pj-detail-main">
          <SummaryEditor key={item.id} value={item.summary} onSave={(summary) => update({ summary })} />

          <section className="pj-sect">
            <h3 className="pj-sect-title">Description</h3>
            <DescriptionEditor key={item.id} value={item.description} onSave={(description) => update({ description })} />
          </section>

          {item.type !== 'subtask' && (
            <section className="pj-sect">
              <div className="pj-sect-head">
                <h3 className="pj-sect-title">Child work items</h3>
                {item.childCount > 0 && <span className="muted small">{item.childDone} of {item.childCount} done</span>}
              </div>
              {item.childCount > 0 && (
                <div className="pj-progress pj-progress-lg" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} title={`${pct}% done`}>
                  <span style={{ width: `${pct}%` }} />
                  <span className="pj-progress-mid" style={{ left: `${pct}%`, width: `${item.childCount ? (item.childInProgress / item.childCount) * 100 : 0}%` }} />
                </div>
              )}
              <div className="pj-children">
                {children.map((c) => (
                  <div key={c.id} className="pj-child" role="button" tabIndex={0}
                    onClick={() => openChild(c.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openChild(c.id); }}>
                    <TypeIcon type={c.type} />
                    <ItemKey item={c} />
                    <span className={`pj-child-summary${c.status === 'done' ? ' done' : ''}`}>{c.summary}</span>
                    <PriorityIcon priority={c.priority} />
                    <Assignee userId={c.assigneeId} size={22} />
                    <span onClick={(e) => e.stopPropagation()}><StatusPill status={c.status} onChange={(status) => projectsApi.updateItem(c.id, { status }).catch((e) => setErr(e?.message))} /></span>
                  </div>
                ))}
                <AddChild parent={item} onError={setErr} />
              </div>
            </section>
          )}

          <section className="pj-sect">
            <div className="pj-subtabs" role="tablist">
              <button role="tab" aria-selected={tab === 'comments'} className={tab === 'comments' ? 'active' : ''} onClick={() => setTab('comments')}>Comments</button>
              <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>History</button>
            </div>
            {tab === 'comments' ? <Comments itemId={item.id} currentUser={currentUser} /> : <History item={item} />}
          </section>
        </div>

        <aside className="pj-detail-side">
          <div className="pj-side-status">
            <StatusPill status={item.status} onChange={(status) => update({ status })} />
            {item.status === 'done' && item.resolvedAt && <span className="muted small">Resolved {timeAgo(item.resolvedAt)}</span>}
          </div>
          <div className="pj-fields">
            <Field label="Type">
              <Dropdown className="pj-field-btn" width={180} ariaLabel={`Type: ${TYPE_LABEL[item.type]}`}
                label={<><TypeIcon type={item.type} /> {TYPE_LABEL[item.type]}</>}>
                {(close) => (
                  <div className="pj-menu" role="menu">
                    {TYPE_ORDER.map((t) => (
                      <MenuItem key={t} checked={t === item.type} icon={<TypeIcon type={t} />}
                        disabled={(t === 'epic' && !!item.parentId) || (t === 'subtask' && item.childCount > 0)}
                        hint={t === 'epic' && item.parentId ? 'has parent' : t === 'subtask' && item.childCount > 0 ? 'has children' : undefined}
                        onClick={() => { close(); if (t !== item.type) update({ type: t as ItemType }); }}>{TYPE_LABEL[t]}</MenuItem>
                    ))}
                  </div>
                )}
              </Dropdown>
            </Field>
            <Field label="Priority">
              <Dropdown className="pj-field-btn" width={180} ariaLabel={`Priority: ${PRIORITY_LABEL[item.priority]}`}
                label={<><PriorityIcon priority={item.priority} /> {PRIORITY_LABEL[item.priority]}</>}>
                {(close) => (
                  <div className="pj-menu" role="menu">
                    {PRIORITY_ORDER.map((p) => <MenuItem key={p} checked={p === item.priority} icon={<PriorityIcon priority={p} />} onClick={() => { close(); update({ priority: p as Priority }); }}>{PRIORITY_LABEL[p]}</MenuItem>)}
                  </div>
                )}
              </Dropdown>
            </Field>
            <Field label="Assignee">
              <div className="pj-field-stack">
                <Dropdown className="pj-field-btn" width={260} ariaLabel={`Assignee: ${memberName(item.assigneeId)}`}
                  label={<Assignee userId={item.assigneeId} size={22} showName />}>
                  {(close) => <MemberList value={item.assigneeId} meId={currentUser.id} onPick={(id) => { close(); update({ assigneeId: id }); }} />}
                </Dropdown>
                {item.assigneeId !== currentUser.id && <button className="pj-link-btn small" onClick={() => update({ assigneeId: currentUser.id })}>Assign to me</button>}
              </div>
            </Field>
            <Field label="Reporter">
              <Dropdown className="pj-field-btn" width={260} ariaLabel={`Reporter: ${memberName(item.reporterId, 'None')}`}
                label={<Assignee userId={item.reporterId} size={22} showName />}>
                {(close) => <MemberList value={item.reporterId} meId={currentUser.id} noneLabel="No reporter" onPick={(id) => { close(); update({ reporterId: id }); }} />}
              </Dropdown>
            </Field>
            {item.type !== 'epic' && (
              <Field label={item.type === 'subtask' ? 'Parent' : 'Epic'}>
                {item.type === 'subtask' ? (
                  <ParentPicker item={item} onPick={(parentId) => update({ parentId })} />
                ) : (
                  <Dropdown className="pj-field-btn" width={280} ariaLabel="Epic"
                    label={parent ? <span className="pj-epic-field"><span className="pj-epic-dot" style={{ background: epicColor(parent.id) }} />{parent.key} {parent.summary}</span> : <span className="pj-faint">None</span>}>
                    {(close) => (
                      <div className="pj-menu" role="menu">
                        <div className="pj-pop-scroll">
                          <MenuItem checked={!item.parentId} onClick={() => { close(); update({ parentId: null }); }}>No epic</MenuItem>
                          {epics.map((e) => (
                            <MenuItem key={e.id} checked={item.parentId === e.id} icon={<span className="pj-epic-dot" style={{ background: epicColor(e.id) }} />} hint={e.key}
                              onClick={() => { close(); update({ parentId: e.id }); }}>{e.summary}</MenuItem>
                          ))}
                          {!epics.length && <div className="pj-pop-empty">No epics in this space yet.</div>}
                        </div>
                      </div>
                    )}
                  </Dropdown>
                )}
              </Field>
            )}
            <Field label="Start date">
              <DateField value={item.startDate} onChange={(startDate) => update({ startDate })} label="Start date" />
            </Field>
            <Field label="Due date">
              <DateField value={item.dueDate} onChange={(dueDate) => update({ dueDate })} label="Due date" overdue={isOverdue(item, today)} min={item.startDate ?? undefined} />
            </Field>
            <Field label="Labels">
              <Labels value={item.labels} onChange={(labels) => update({ labels })} />
            </Field>
          </div>
          <div className="pj-side-meta muted small">
            <div title={formatFull(item.createdAt)}>Created {timeAgo(item.createdAt)}</div>
            <div title={formatFull(item.updatedAt)}>Updated {timeAgo(item.updatedAt)}</div>
            {item.reopenedCount > 0 && <div>Reopened {item.reopenedCount}×</div>}
          </div>
        </aside>
      </div>

      {sharing && <ShareDialog item={item} workspaceId={workspaceId} currentUser={currentUser} onClose={() => setSharing(false)} onShared={(t) => setFlash(`Shared to ${t}`)} />}
      {deleting && (
        <ConfirmDialog title={`Delete ${item.key}?`} confirmLabel="Delete"
          body={<p>“{item.summary}”{item.childCount ? ` and its ${item.childCount} child item${item.childCount === 1 ? '' : 's'}` : ''} will be deleted for everyone. This can’t be undone.</p>}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            const pid = item.projectId;
            await projectsApi.deleteItem(item.id);
            if (mode === 'panel') onClose?.();
            else navigate(`/w/${workspaceId}/projects/p/${pid}`);
          }} />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pj-field">
      <div className="pj-field-label">{label}</div>
      <div className="pj-field-value">{children}</div>
    </div>
  );
}

function SummaryEditor({ value, onSave }: { value: string; onSave(v: string): void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!editing) setV(value); }, [value, editing]);
  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }
  }, [v, editing]);
  const commit = () => {
    setEditing(false);
    const t = v.replace(/\s+/g, ' ').trim();
    if (t && t !== value) onSave(t); else setV(value);
  };
  if (!editing) {
    return <h1 className="pj-detail-summary" tabIndex={0} role="button" title="Click to edit" onClick={() => setEditing(true)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setEditing(true); } }}>{value}</h1>;
  }
  return (
    <textarea ref={ref} className="pj-detail-summary pj-summary-input" autoFocus value={v} maxLength={255} rows={1} aria-label="Summary"
      onFocus={(e) => e.target.select()} onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setV(value); setEditing(false); }
      }} />
  );
}

function DescriptionEditor({ value, onSave }: { value: string; onSave(v: string): Promise<unknown> | void }) {
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => { if (!editing) setV(value); }, [value, editing]);
  const save = async () => { await onSave(v); setEditing(false); setPreview(false); };
  const cancel = () => { setV(value); setEditing(false); setPreview(false); };
  if (!editing) {
    return (
      <div className={`pj-desc${value ? '' : ' empty'}`} role="button" tabIndex={0} title="Click to edit"
        onClick={(e) => { if ((e.target as HTMLElement).closest('a')) return; setEditing(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); setEditing(true); } }}>
        {value ? <Markdown text={value} /> : <span className="pj-faint">Add a description…</span>}
      </div>
    );
  }
  return (
    <div className="pj-desc-edit">
      <div className="pj-desc-tabs">
        <button className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>Write</button>
        <button className={preview ? 'active' : ''} onClick={() => setPreview(true)}>Preview</button>
        <span className="grow" />
        <span className="muted small">Markdown: *bold*, _italic_, `code`, &gt; quote, - lists</span>
      </div>
      {preview
        ? <div className="pj-desc pj-desc-preview">{v.trim() ? <Markdown text={v} /> : <span className="pj-faint">Nothing to preview</span>}</div>
        : <textarea className="input pj-desc-input" autoFocus rows={8} value={v} maxLength={20000} onChange={(e) => setV(e.target.value)} aria-label="Description"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
          }} />}
      <div className="row gap-sm">
        <button className="btn btn-primary btn-sm" onClick={save}>Save</button>
        <button className="btn btn-sm" onClick={cancel}>Cancel</button>
        <span className="muted small">Ctrl+Enter to save · Esc to cancel</span>
      </div>
    </div>
  );
}

function DateField({ value, onChange, label, overdue, min }: { value: string | null; onChange(v: string | null): void; label: string; overdue?: boolean; min?: string }) {
  return (
    <div className={`pj-date${overdue ? ' overdue' : ''}`}>
      <input type="date" className="pj-date-input" value={value ?? ''} min={min} aria-label={label}
        onChange={(e) => onChange(e.target.value || null)} />
      {value && <button className="pj-date-clear" aria-label={`Clear ${label.toLowerCase()}`} title="Clear" onClick={() => onChange(null)}><Icon name="x" size={12} /></button>}
      {overdue && <span className="pj-overdue small">Overdue</span>}
      {!value && <span className="pj-faint small pj-date-none">None</span>}
    </div>
  );
}

function Labels({ value, onChange }: { value: string[]; onChange(v: string[]): void }) {
  const [v, setV] = useState('');
  const add = () => {
    const t = v.trim().replace(/\s+/g, '-').slice(0, 40);
    if (t && !value.includes(t) && value.length < 20) onChange([...value, t]);
    setV('');
  };
  return (
    <div className="pj-labels-edit">
      {value.map((l) => (
        <span key={l} className="pj-label">{l}<button aria-label={`Remove label ${l}`} onClick={() => onChange(value.filter((x) => x !== l))}><Icon name="x" size={10} /></button></span>
      ))}
      <input className="pj-label-input" value={v} placeholder={value.length ? 'Add…' : 'Add a label'} aria-label="Add label" onChange={(e) => setV(e.target.value)}
        onBlur={() => v.trim() && add()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
          if (e.key === 'Backspace' && !v && value.length) onChange(value.slice(0, -1));
          if (e.key === 'Escape' && v) { e.stopPropagation(); setV(''); }
        }} />
    </div>
  );
}

/** For subtasks: pick any non-subtask item in the same space as the parent. */
function ParentPicker({ item, onPick }: { item: WorkItem; onPick(id: string | null): void }) {
  const allItems = useProjects((s) => s.items);
  const parent = item.parentId ? allItems[item.parentId] : undefined;
  const [q, setQ] = useState('');
  const options = useMemo(() => projectItems(allItems, item.projectId).filter((i) => i.id !== item.id && i.type !== 'subtask')
    .filter((i) => !q.trim() || i.summary.toLowerCase().includes(q.toLowerCase()) || i.key.toLowerCase().includes(q.toLowerCase())).slice(0, 50), [allItems, item, q]);
  return (
    <Dropdown className="pj-field-btn" width={300} ariaLabel="Parent"
      label={parent ? <span className="row gap-sm"><TypeIcon type={parent.type} size={14} />{parent.key} {parent.summary}</span> : <span className="pj-faint">None</span>}>
      {(close) => (
        <div>
          <input className="pj-pop-search" autoFocus placeholder="Search work items" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search work items" />
          <div className="pj-pop-scroll">
            <MenuItem checked={!item.parentId} onClick={() => { close(); onPick(null); }}>No parent</MenuItem>
            {options.map((o) => <MenuItem key={o.id} checked={o.id === item.parentId} icon={<TypeIcon type={o.type} />} hint={o.key} onClick={() => { close(); onPick(o.id); }}>{o.summary}</MenuItem>)}
          </div>
        </div>
      )}
    </Dropdown>
  );
}

function AddChild({ parent, onError }: { parent: WorkItem; onError(e: string): void }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState('');
  const childType: ItemType = parent.type === 'epic' ? 'task' : 'subtask';
  const [type, setType] = useState<ItemType>(childType);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const s = summary.trim();
    if (!s || busy) return;
    setBusy(true);
    try { await projectsApi.createItem(parent.projectId, { summary: s, parentId: parent.id, type }); setSummary(''); onError(''); } catch (e: any) { onError(e?.message || 'Could not add the child item'); }
    setBusy(false);
  };
  if (!open) return <button className="pj-add-child" onClick={() => setOpen(true)}><Icon name="plus" size={15} /> Add child work item</button>;
  const types: ItemType[] = parent.type === 'epic' ? ['task', 'story', 'bug'] : ['subtask'];
  return (
    <div className="pj-add-child-form">
      {types.length > 1 ? (
        <select className="pj-select" value={type} onChange={(e) => setType(e.target.value as ItemType)} aria-label="Type">
          {types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
      ) : <TypeIcon type={type} />}
      <input className="input" autoFocus value={summary} maxLength={255} placeholder="What needs to be done?" aria-label="Child summary"
        onChange={(e) => setSummary(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); setSummary(''); }
        }} />
      <button className="btn btn-primary btn-sm" disabled={!summary.trim() || busy} onClick={submit}>{busy ? <span className="spinner" /> : 'Add'}</button>
      <button className="btn btn-sm btn-ghost" onClick={() => { setOpen(false); setSummary(''); }}>Cancel</button>
    </div>
  );
}

function Comments({ itemId, currentUser }: { itemId: string; currentUser: User }) {
  const [list, setList] = useState<Comment[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    setList(null);
    projectsApi.comments(itemId).then((c) => alive && setList(c)).catch(() => alive && setList([]));
    const off = ws.on('item.commented', (p: { comment: Comment }) => {
      if (p?.comment?.itemId !== itemId) return;
      setList((l) => (l && !l.some((c) => c.id === p.comment.id) ? [...l, p.comment] : l));
    });
    return () => { alive = false; off(); };
  }, [itemId]);
  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setErr('');
    try {
      const c = await projectsApi.addComment(itemId, t);
      setList((l) => (l && !l.some((x) => x.id === c.id) ? [...l, c] : l));
      setText('');
    } catch (e: any) { setErr(e?.message || 'Could not post the comment'); }
    setBusy(false);
  };
  return (
    <div className="pj-comments">
      <div className="pj-composer">
        <Avatar user={currentUser} size={30} />
        <div className="grow">
          <textarea className="input" rows={text ? 3 : 1} value={text} placeholder="Add a comment…" aria-label="Add a comment" maxLength={10000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey) && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
              if (e.key === 'Escape' && text) { e.stopPropagation(); setText(''); }
            }} />
          {text && (
            <div className="row gap-sm pj-composer-actions">
              <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()} onClick={submit}>{busy ? <span className="spinner" /> : 'Comment'}</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setText('')}>Cancel</button>
              <span className="muted small">Enter to post · Shift+Enter for a new line</span>
            </div>
          )}
          {err && <p className="form-error">{err}</p>}
        </div>
      </div>
      {list === null ? <div className="loading-block"><span className="spinner" /></div>
        : !list.length ? <p className="muted small pj-none">No comments yet.</p>
          : list.slice().reverse().map((c) => <CommentRow key={c.id} c={c} />)}
    </div>
  );
}
function CommentRow({ c }: { c: Comment }) {
  const author = useSession((s) => s.members[c.userId]);
  return (
    <div className="pj-comment">
      <Avatar user={author} userId={c.userId} size={30} />
      <div className="grow">
        <div className="pj-comment-head"><b>{displayName(author)}</b> <time className="muted small" title={formatFull(c.createdAt)}>{timeAgo(c.createdAt)}</time></div>
        <div className="pj-comment-text"><Markdown text={c.text} /></div>
      </div>
    </div>
  );
}

function History({ item }: { item: WorkItem }) {
  const [list, setList] = useState<Activity[] | null>(null);
  const version = item.updatedAt;
  useEffect(() => {
    let alive = true;
    projectsApi.activity(item.id).then((a) => alive && setList(a)).catch(() => alive && setList([]));
    return () => { alive = false; };
  }, [item.id, version]);
  if (list === null) return <div className="loading-block"><span className="spinner" /></div>;
  if (!list.length) return <p className="muted small pj-none">No history yet.</p>;
  return (
    <ol className="pj-history">
      {list.map((a) => <li key={a.id}><HistoryRow a={a} /></li>)}
    </ol>
  );
}

const FIELD_LABEL: Record<string, string> = {
  summary: 'summary', description: 'description', status: 'status', priority: 'priority', type: 'type', assignee: 'assignee',
  reporter: 'reporter', parent: 'parent', startDate: 'start date', dueDate: 'due date', labels: 'labels',
};
function fmtValue(field: string, v: string | null): string {
  if (v == null || v === '') return 'None';
  switch (field) {
    case 'status': return STATUS_LABEL[v as ItemStatus] ?? v;
    case 'priority': return PRIORITY_LABEL[v as Priority] ?? v;
    case 'type': return TYPE_LABEL[v as ItemType] ?? v;
    case 'assignee': case 'reporter': return memberName(v, 'Unassigned');
    case 'parent': { const p = useProjects.getState().items[v]; return p ? p.key : 'a deleted item'; }
    case 'startDate': case 'dueDate': return formatDate(v);
    case 'labels': { try { const a = JSON.parse(v) as string[]; return a.length ? a.join(', ') : 'None'; } catch { return v; } }
    default: return v.length > 80 ? `${v.slice(0, 80)}…` : v;
  }
}
/** Human-readable activity: "Ben changed status from To do to In progress · 2 hr ago". */
function HistoryRow({ a }: { a: Activity }) {
  const actor = useSession((s) => (a.actorId ? s.members[a.actorId] : undefined));
  const who = a.actorId ? displayName(actor) : 'Someone';
  let what: ReactNode;
  if (a.field === 'created') what = <>created the work item</>;
  else if (a.field === 'comment') what = <>commented: <span className="pj-quote">“{fmtValue('comment', a.to)}”</span></>;
  else if (a.field === 'description') what = <>{a.from ? 'updated' : 'added'} the description</>;
  else if (a.field === 'assignee' && a.to && !a.from) what = <>assigned this to <b>{fmtValue('assignee', a.to)}</b></>;
  else if (a.field === 'assignee' && !a.to) what = <>unassigned <b>{fmtValue('assignee', a.from)}</b></>;
  else {
    const f = FIELD_LABEL[a.field] ?? a.field;
    what = a.from == null || a.from === '' || a.from === '[]'
      ? <>set {f} to <b>{fmtValue(a.field, a.to)}</b></>
      : <>changed {f} from <b>{fmtValue(a.field, a.from)}</b> to <b>{fmtValue(a.field, a.to)}</b></>;
  }
  return (
    <div className="pj-hist">
      <Avatar user={actor} userId={a.actorId ?? undefined} size={24} />
      <div className="grow"><b>{who}</b> {what} <span className="muted small" title={formatFull(a.createdAt)}>· {timeAgo(a.createdAt)}</span></div>
    </div>
  );
}

function ShareDialog({ item, workspaceId, currentUser, onClose, onShared }: {
  item: WorkItem; workspaceId: string; currentUser: User; onClose(): void; onShared(title: string): void;
}) {
  const byId = useConversations((s) => s.byId);
  const members = useSession((s) => s.members);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const convs = useMemo(() => {
    const s = q.trim().toLowerCase();
    return Object.values(byId).filter((c) => c.workspaceId === workspaceId && c.isMember && !c.isArchived)
      .map((c) => ({ c, title: conversationTitle(c, members, currentUser) }))
      .filter((x) => !s || x.title.toLowerCase().includes(s))
      .sort((a, b) => (a.c.kind === 'channel' ? 0 : 1) - (b.c.kind === 'channel' ? 0 : 1) || (b.c.lastMessageAt ?? 0) - (a.c.lastMessageAt ?? 0))
      .slice(0, 50);
  }, [byId, workspaceId, q, members, currentUser]);
  const picked = pick ? byId[pick] : undefined;
  const pickedTitle = picked ? conversationTitle(picked, members, currentUser) : '';
  const share = async () => {
    if (!pick) return;
    setBusy(true); setErr('');
    try {
      await projectsApi.share(item.id, pick, comment.trim() || undefined);
      onShared(picked?.kind === 'channel' ? `#${pickedTitle}` : pickedTitle);
      onClose();
    } catch (e: any) { setErr(e?.message || 'Could not share'); setBusy(false); }
  };
  return (
    <Modal title={`Share ${item.key}`} onClose={onClose} width={480}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!pick || busy} onClick={share}>{busy ? <span className="spinner" /> : 'Share'}</button>
      </>}>
      <div className="pj-form">
        <div className="pj-share-preview"><TypeIcon type={item.type} /> <b>{item.key}</b> <span className="grow pj-ellipsis">{item.summary}</span> <StatusPill status={item.status} /></div>
        <label className="field">Share to
          <input className="input" autoFocus placeholder="Search channels and direct messages" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="pj-share-list" role="listbox" aria-label="Conversations">
          {convs.map(({ c, title }) => (
            <button key={c.id} role="option" aria-selected={pick === c.id} className={`pj-menu-item${pick === c.id ? ' checked' : ''}`} onClick={() => setPick(c.id)}>
              <span className="pj-menu-icon">{c.kind === 'channel' ? <Icon name={c.isPrivate ? 'lock' : 'hash'} size={15} /> : <Icon name="messages" size={15} />}</span>
              <span className="pj-menu-label">{title}</span>
              {pick === c.id && <Icon name="check" size={14} />}
            </button>
          ))}
          {!convs.length && <div className="pj-pop-empty">No conversations match.</div>}
        </div>
        <label className="field">Message <span className="muted small" style={{ fontWeight: 400 }}>(optional)</span>
          <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a note for everyone in the conversation" />
        </label>
        {err && <p className="form-error">{err}</p>}
      </div>
    </Modal>
  );
}

