import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { askConfirm, askText } from '../../components/Dialogs';
import { projectsApi } from './api';
import { useProjects } from './store';
import type { ItemQuery, SavedFilter, WorkItem } from './types';
import { PRIORITY_LABEL, PRIORITY_ORDER, STATUS_LABEL, STATUS_ORDER, TYPE_LABEL, TYPE_ORDER } from './types';
import { Assignee, ItemKey, PriorityIcon, StatusPill, TypeIcon, formatDate, todayIso, useItemPanel } from './ui';
import { displayName, useSession } from '../../store/session';
import { Icon } from '../../components/Icon';
import type { ProjectsViewProps } from './ProjectsRoot';
import './home.css';

type MultiField = 'type' | 'status' | 'priority';

/** Drop empty fields so a saved filter only stores what it constrains. */
function cleanQuery(q: ItemQuery): ItemQuery {
  const out: ItemQuery = {};
  if (q.projectId) out.projectId = q.projectId;
  if (q.text?.trim()) out.text = q.text.trim();
  if (q.ask?.trim()) out.ask = q.ask.trim();
  if (q.assignee?.length) out.assignee = q.assignee;
  if (q.status?.length) out.status = q.status;
  if (q.type?.length) out.type = q.type;
  if (q.priority?.length) out.priority = q.priority;
  return out;
}

/** Saved filters and a query builder with live results across every space. */
export default function FiltersPage({ workspaceId, currentUser }: ProjectsViewProps) {
  const version = useProjects((s) => s.version);
  const projects = useProjects((s) => s.projects);
  const storeItems = useProjects((s) => s.items);
  const members = useSession((s) => s.members);

  const [saved, setSaved] = useState<SavedFilter[] | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState<ItemQuery>({});
  const [askDraft, setAskDraft] = useState('');
  const [results, setResults] = useState<{ items: WorkItem[]; explanation: string[] } | null>(null);
  const [resultsError, setResultsError] = useState<string | null>(null);

  const spaces = useMemo(() => Object.values(projects).sort((a, b) => a.name.localeCompare(b.name)), [projects]);
  const people = useMemo(
    () => Object.values(members).filter((m) => !m.deactivated && !m.isBot).sort((a, b) => displayName(a).localeCompare(displayName(b))),
    [members],
  );

  useEffect(() => {
    let alive = true;
    projectsApi.filters(workspaceId)
      .then((list) => { if (alive) { setSaved([...list].sort((a, b) => a.name.localeCompare(b.name))); setSavedError(null); } })
      .catch((e: Error) => { if (alive) setSavedError(e.message); });
    return () => { alive = false; };
  }, [workspaceId]);

  // Live results: re-run shortly after any change to the query or to the data.
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      projectsApi.searchItems(workspaceId, query)
        .then((r) => { if (alive) { setResults(r); setResultsError(null); } })
        .catch((e: Error) => { if (alive) setResultsError(e.message); });
    }, 200);
    return () => { alive = false; window.clearTimeout(timer); };
    // The query is compared by its serialised form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, queryKey, version]);

  const toggle = (field: MultiField, value: string) => {
    const cur = (query[field] ?? []) as string[];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    setActiveId(null);
    setQuery({ ...query, [field]: next.length ? next : undefined });
  };

  const update = (patch: Partial<ItemQuery>) => {
    setActiveId(null);
    setQuery({ ...query, ...patch });
  };

  const runAsk = (e: FormEvent) => {
    e.preventDefault();
    update({ ask: askDraft.trim() || undefined });
  };

  const clearAll = () => {
    setQuery({});
    setAskDraft('');
    setActiveId(null);
  };

  const openSaved = (f: SavedFilter) => {
    setQuery(f.query);
    setAskDraft(f.query.ask ?? '');
    setActiveId(f.id);
  };

  const saveCurrent = async () => {
    const name = await askText('Name this filter', { label: 'Filter name' });
    if (!name) return;
    setSavedError(null);
    try {
      const f = await projectsApi.saveFilter(workspaceId, name, cleanQuery(query));
      setSaved((list) => [...(list ?? []), f].sort((a, b) => a.name.localeCompare(b.name)));
      setActiveId(f.id);
    } catch (e) {
      setSavedError(e instanceof Error ? e.message : 'Could not save the filter');
    }
  };

  const removeSaved = async (f: SavedFilter) => {
    if (!await askConfirm(`Delete the saved filter “${f.name}”?`, { danger: true, action: 'Delete' })) return;
    setSavedError(null);
    try {
      await projectsApi.deleteFilter(f.id);
      setSaved((list) => list?.filter((x) => x.id !== f.id) ?? list);
      if (activeId === f.id) setActiveId(null);
    } catch (e) {
      setSavedError(e instanceof Error ? e.message : 'Could not delete the filter');
    }
  };

  const rows = (results?.items ?? []).map((i) => storeItems[i.id] ?? i);
  const explanation = results?.explanation ?? [];
  const isEmpty = !query.projectId && !query.text && !query.ask && !query.assignee?.length && !query.status?.length && !query.type?.length && !query.priority?.length;

  return (
    <div className="hm-filters">
      <aside className="hm-saved" aria-label="Saved filters">
        <h2 className="hm-saved-title">Saved filters</h2>
        {savedError && <div className="hm-error" role="alert">{savedError}</div>}
        {saved === null && !savedError && <div className="hm-sub">Loading…</div>}
        {saved?.length === 0 && <div className="hm-sub">No saved filters yet. Build a query and choose Save filter.</div>}
        {saved?.map((f) => (
          <div key={f.id} className={`hm-saved-item${activeId === f.id ? ' is-active' : ''}`}>
            <button type="button" className="hm-saved-open" onClick={() => openSaved(f)} title={f.name}>{f.name}</button>
            <button type="button" className="icon-btn hm-saved-del" aria-label={`Delete filter ${f.name}`} onClick={() => removeSaved(f)}>
              <Icon name="trash" size={14} />
            </button>
          </div>
        ))}
      </aside>

      <div className="hm-main">
        <div className="hm-toolbar">
          <div>
            <h1 className="hm-title">Filters</h1>
            <p className="hm-sub">Find work items across every space. Describe what you need in plain English or pick options below.</p>
          </div>
          <div className="hm-onboard-actions" style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={clearAll} disabled={isEmpty}>Clear</button>
            <button type="button" className="btn btn-primary" onClick={saveCurrent} disabled={isEmpty}>Save filter</button>
          </div>
        </div>

        <form className="hm-ask-row" onSubmit={runAsk} role="search">
          <input className="input" aria-label="Ask in plain English" placeholder="Ask, e.g. my high priority bugs in review" value={askDraft}
            onChange={(e) => setAskDraft(e.target.value)} />
          <button type="submit" className="btn">Ask</button>
          {query.ask && <button type="button" className="btn btn-ghost" onClick={() => { setAskDraft(''); update({ ask: undefined }); }}>Clear question</button>}
        </form>

        <div className="hm-builder">
          <label className="hm-field">
            Space
            <select className="input" value={query.projectId ?? ''} onChange={(e) => update({ projectId: e.target.value || undefined })}>
              <option value="">All spaces</option>
              {spaces.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="hm-field">
            Text
            <input className="input" value={query.text ?? ''} placeholder="Words in the title or description" onChange={(e) => update({ text: e.target.value || undefined })} />
          </label>
          <label className="hm-field">
            Assignee
            <select className="input" value={query.assignee?.[0] ?? ''} onChange={(e) => update({ assignee: e.target.value ? [e.target.value] : undefined })}>
              <option value="">Anyone</option>
              <option value="me">Me ({displayName(currentUser)})</option>
              <option value="none">Unassigned</option>
              {people.filter((p) => p.id !== currentUser.id).map((p) => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
            </select>
          </label>
        </div>

        <div className="hm-builder">
          <ChipGroup label="Type" options={TYPE_ORDER.map((t) => [t, TYPE_LABEL[t]])} selected={query.type ?? []} onToggle={(v) => toggle('type', v)} />
          <ChipGroup label="Status" options={STATUS_ORDER.map((s) => [s, STATUS_LABEL[s]])} selected={query.status ?? []} onToggle={(v) => toggle('status', v)} />
          <ChipGroup label="Priority" options={PRIORITY_ORDER.map((p) => [p, PRIORITY_LABEL[p]])} selected={query.priority ?? []} onToggle={(v) => toggle('priority', v)} />
        </div>

        {explanation.length > 0 && (
          <div className="hm-understood" aria-label="How the question was understood">
            <span>Understood as</span>
            {explanation.map((x) => <span key={x} className="hm-understood-chip">{x}</span>)}
          </div>
        )}

        {resultsError && <div className="hm-error" role="alert">{resultsError}</div>}

        <div className="hm-toolbar">
          <span className="hm-count">{results ? `${rows.length} ${rows.length === 1 ? 'work item' : 'work items'}` : 'Searching…'}</span>
        </div>

        <div className="hm-results">
          {results && rows.length === 0 ? (
            <div className="hm-empty" style={{ margin: 16 }}>No work items match this filter.</div>
          ) : (
            <table className="hm-table">
              <thead>
                <tr>
                  <th>Type</th><th>Key</th><th>Summary</th><th>Space</th><th>Status</th><th>Assignee</th><th>Priority</th><th>Due</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  const overdue = !!i.dueDate && i.status !== 'done' && i.dueDate < todayIso();
                  return (
                    <tr key={i.id} onClick={() => useItemPanel.getState().openItem(i.id)}>
                      <td><TypeIcon type={i.type} /></td>
                      <td><ItemKey item={i} /></td>
                      <td className="hm-td-summary"><span>{i.summary}</span></td>
                      <td>{projects[i.projectId]?.name ?? ''}</td>
                      <td><StatusPill status={i.status} /></td>
                      <td><Assignee userId={i.assigneeId} size={22} showName /></td>
                      <td><span className="hm-priority"><PriorityIcon priority={i.priority} />{PRIORITY_LABEL[i.priority]}</span></td>
                      <td className={overdue ? 'is-overdue' : undefined}>{i.dueDate ? formatDate(i.dueDate) : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!results && <div className="hm-loading">Searching…</div>}
        </div>
      </div>
    </div>
  );
}

function ChipGroup({ label, options, selected, onToggle }: {
  label: string;
  options: string[][];
  selected: string[];
  onToggle(value: string): void;
}) {
  return (
    <div className="hm-chip-group">
      <span className="hm-field">{label}</span>
      <div className="hm-chips">
        {options.map(([value, text]) => (
          <button key={value} type="button" className="hm-chip" aria-pressed={selected.includes(value)} onClick={() => onToggle(value)}>{text}</button>
        ))}
      </div>
    </div>
  );
}
