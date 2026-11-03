import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import type { ProjectsViewProps } from './ProjectsRoot';
import type { ItemStatus, ItemType, Priority, WorkItem } from './types';
import { PRIORITY_LABEL, PRIORITY_ORDER, STATUS_LABEL, STATUS_ORDER, TYPE_LABEL, TYPE_ORDER } from './types';
import { projectItems, useProjects } from './store';
import { projectsApi } from './api';
import { TypeIcon, useItemPanel } from './ui';
import { useMembers } from './kit';
import { showToast } from './toast';
import { Modal } from '../../components/Modal';
import { displayName } from '../../store/session';
import './item.css';

/** The "Create work item" dialog, shown whenever `useItemPanel.create` is set. */
export default function CreateItemModal({ workspaceId, currentUser }: ProjectsViewProps) {
  const create = useItemPanel((s) => s.create);
  if (!create) return null;
  return <CreateForm workspaceId={workspaceId} currentUser={currentUser} defaults={create} />;
}

function CreateForm({ workspaceId, currentUser, defaults }: ProjectsViewProps & { defaults: NonNullable<ReturnType<typeof useItemPanel.getState>['create']> }) {
  const close = useItemPanel((s) => s.closeCreate);
  const location = useLocation();
  const projects = useProjects((s) => s.projects);
  const allItems = useProjects((s) => s.items);
  const members = useMembers();
  const spaces = useMemo(() => Object.values(projects).filter((p) => p.workspaceId === workspaceId).sort((a, b) => a.name.localeCompare(b.name)), [projects, workspaceId]);

  const initialProject = useMemo(() => {
    if (defaults.projectId && projects[defaults.projectId]) return defaults.projectId;
    const m = /\/projects\/p\/([^/]+)/.exec(location.pathname);
    if (m && projects[m[1]]) return m[1];
    const recent = spaces.filter((p) => p.visitedAt).sort((a, b) => (b.visitedAt ?? 0) - (a.visitedAt ?? 0))[0];
    return recent?.id ?? spaces[0]?.id ?? '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const parentDefault = defaults.parentId ? allItems[defaults.parentId] : undefined;

  const [projectId, setProjectId] = useState(parentDefault?.projectId ?? initialProject);
  const [type, setType] = useState<ItemType>(defaults.type ?? (parentDefault ? (parentDefault.type === 'epic' ? 'task' : 'subtask') : 'task'));
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [parentId, setParentId] = useState<string>(defaults.parentId ?? '');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [status, setStatus] = useState<ItemStatus>(defaults.status ?? 'todo');
  const [another, setAnother] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [created, setCreated] = useState<WorkItem[]>([]);
  const summaryRef = useRef<HTMLInputElement>(null);

  // Make sure the chosen space's items (for the parent picker) are loaded.
  useEffect(() => { if (projectId) projectsApi.listItems(projectId).catch(() => {}); }, [projectId]);
  // No spaces in the store yet (e.g. a fresh load): fetch them.
  useEffect(() => { if (!spaces.length) projectsApi.listProjects(workspaceId).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!projectId && spaces[0]) setProjectId(spaces[0].id); }, [projectId, spaces]);

  const parents = useMemo(() => {
    if (!projectId) return [];
    const list = projectItems(allItems, projectId);
    // Subtasks hang under any non-subtask item; everything else under an epic.
    return type === 'subtask' ? list.filter((i) => i.type !== 'subtask') : list.filter((i) => i.type === 'epic');
  }, [allItems, projectId, type]);
  // Drop a parent that no longer fits the space or type.
  useEffect(() => {
    const p = parentId ? allItems[parentId] : undefined;
    if (p && (p.projectId !== projectId || type === 'epic' || (type === 'subtask' && p.type === 'subtask'))) setParentId('');
  }, [parentId, projectId, type, allItems]);

  const needsParent = type === 'subtask' && !parentId;
  const dateErr = startDate && dueDate && dueDate < startDate ? 'The due date is before the start date.' : '';
  const canSubmit = !!projectId && !!summary.trim() && !busy && !needsParent && !dateErr;
  const project = projects[projectId];

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setErr('');
    try {
      const item = await projectsApi.createItem(projectId, {
        summary: summary.trim(), description: description.trim(), type, status, priority,
        assigneeId: assigneeId || null, parentId: type === 'epic' ? null : (parentId || null),
        startDate: startDate || null, dueDate: dueDate || null,
      });
      if (another) {
        setCreated((c) => [item, ...c].slice(0, 5));
        setSummary(''); setDescription('');
        setBusy(false);
        summaryRef.current?.focus();
      } else {
        close();
        showToast(`Created ${item.key}: ${item.summary}`, `/w/${workspaceId}/projects/item/${item.id}`);
      }
    } catch (e: any) {
      setErr(e?.message || 'Could not create the work item');
      setBusy(false);
    }
  };

  return (
    <Modal title="Create work item" onClose={close} width={640} className="pj-create-modal"
      footer={<>
        <label className="toggle-row pj-another"><input type="checkbox" checked={another} onChange={(e) => setAnother(e.target.checked)} /> Create another</label>
        <span className="grow" />
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>{busy ? <span className="spinner" /> : 'Create'}</button>
      </>}>
      <form className="pj-form" onSubmit={(e) => { e.preventDefault(); submit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}>
        {created.length > 0 && (
          <div className="pj-created" role="status">
            {created.map((c) => (
              <div key={c.id} className="pj-created-row">
                <span className="pj-created-check">✓</span> Created <TypeIcon type={c.type} size={14} />
                <button type="button" className="pj-key" onClick={() => { useItemPanel.getState().openItem(c.id); close(); }}>{c.key}</button>
                <span className="pj-ellipsis grow">{c.summary}</span>
              </div>
            ))}
          </div>
        )}
        {!spaces.length ? (
          <p className="muted">Create a space first, then add work items to it.</p>
        ) : (
          <>
            <div className="pj-form-grid">
              <label className="field">Space
                <select className="input" value={projectId} onChange={(e) => { setProjectId(e.target.value); setParentId(''); }}>
                  {spaces.map((p) => <option key={p.id} value={p.id}>{p.iconEmoji} {p.name} ({p.key})</option>)}
                </select>
              </label>
              <label className="field">Work type
                <select className="input" value={type} onChange={(e) => setType(e.target.value as ItemType)}>
                  {TYPE_ORDER.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </select>
              </label>
            </div>
            <label className="field">Summary <span className="pj-req" aria-hidden="true">*</span>
              <input ref={summaryRef} className="input" autoFocus required maxLength={255} value={summary} onChange={(e) => setSummary(e.target.value)}
                placeholder={type === 'bug' ? 'What went wrong?' : type === 'epic' ? 'Name the larger piece of work' : 'What needs to be done?'} />
            </label>
            <label className="field">Description
              <textarea className="input" rows={4} maxLength={20000} value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Add more detail. Markdown is supported." />
            </label>
            <div className="pj-form-grid">
              <label className="field">Status
                <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ItemStatus)}>
                  {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </label>
              <label className="field">Priority
                <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                  {PRIORITY_ORDER.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                </select>
              </label>
              <label className="field">Assignee
                <div className="pj-field-stack">
                  <select className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                    <option value="">Unassigned</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{displayName(m)}{m.id === currentUser.id ? ' (you)' : ''}</option>)}
                  </select>
                  {assigneeId !== currentUser.id && <button type="button" className="pj-link-btn small" onClick={() => setAssigneeId(currentUser.id)}>Assign to me</button>}
                </div>
              </label>
              {type !== 'epic' && (
                <label className="field">{type === 'subtask' ? 'Parent' : 'Parent epic'}{type === 'subtask' && <span className="pj-req" aria-hidden="true"> *</span>}
                  <select className="input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                    <option value="">{type === 'subtask' ? 'Choose a parent…' : 'None'}</option>
                    {parentId && !parents.some((p) => p.id === parentId) && allItems[parentId] && (
                      <option value={parentId}>{allItems[parentId].key} {allItems[parentId].summary}</option>
                    )}
                    {parents.map((p) => <option key={p.id} value={p.id}>{p.key} {p.summary}</option>)}
                  </select>
                  {type !== 'subtask' && !parents.length && <small className="muted">No epics in {project?.name ?? 'this space'} yet.</small>}
                </label>
              )}
              <label className="field">Start date
                <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </label>
              <label className="field">Due date
                <input className="input" type="date" value={dueDate} min={startDate || undefined} onChange={(e) => setDueDate(e.target.value)} />
              </label>
            </div>
            {needsParent && <small className="muted">Subtasks need a parent work item.</small>}
            {dateErr && <p className="form-error">{dateErr}</p>}
          </>
        )}
        {err && <p className="form-error">{err}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
