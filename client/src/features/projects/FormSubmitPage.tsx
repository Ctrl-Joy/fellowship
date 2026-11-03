import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { projectsApi } from './api';
import { ApiError } from '../../api';
import { useSession, displayName } from '../../store/session';
import type { FormField, Project, ProjectForm, WorkItem } from './types';
import { PRIORITY_LABEL, PRIORITY_ORDER } from './types';
import { useItemPanel } from './ui';
import type { ProjectsViewProps } from './ProjectsRoot';
import './forms.css';

interface Loaded { form: ProjectForm; project: Project }

/** Public page for a form: anyone in the workspace can fill it in and create a work item. */
export default function FormSubmitPage({ workspaceId }: ProjectsViewProps) {
  const { fid = '' } = useParams<{ fid: string }>();
  const members = useSession((s) => s.members);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<WorkItem | null>(null);

  useEffect(() => {
    let alive = true;
    setLoaded(null);
    setLoadError(null);
    setValues({});
    setErrors({});
    setCreated(null);
    projectsApi.getForm(fid)
      .then((r) => { if (alive) setLoaded(r); })
      .catch((e: unknown) => { if (alive) setLoadError(e instanceof ApiError && e.status === 404 ? 'This form does not exist or was deleted.' : e instanceof Error ? e.message : 'Could not load the form'); });
    return () => { alive = false; };
  }, [fid]);

  const people = useMemo(
    () => Object.values(members).filter((m) => !m.deactivated).sort((a, b) => displayName(a).localeCompare(displayName(b))),
    [members],
  );

  if (loadError) return <Shell workspaceId={workspaceId}><div className="fm-page-card"><p className="fm-notice">{loadError}</p></div></Shell>;
  if (!loaded) return <Shell workspaceId={workspaceId}><div className="fm-loading">Loading form…</div></Shell>;

  const { form, project } = loaded;
  const setValue = (id: string, v: string) => {
    setValues((prev) => ({ ...prev, [id]: v }));
    if (errors[id]) setErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };

  const check = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const f of form.fields) {
      const v = (values[f.id] ?? '').trim();
      if (!v) {
        if (f.required) out[f.id] = 'This field is required.';
        continue;
      }
      if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) out[f.id] = 'Use a valid date.';
      if (f.type === 'select' && f.options.length && !f.options.includes(v)) out[f.id] = 'Pick one of the options.';
    }
    return out;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const problems = check();
    setErrors(problems);
    if (Object.keys(problems).length) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const clean: Record<string, string> = {};
      for (const f of form.fields) clean[f.id] = (values[f.id] ?? '').trim();
      const item = await projectsApi.submitForm(fid, clean);
      setCreated(item);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not submit the form');
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setValues({});
    setErrors({});
    setSubmitError(null);
    setCreated(null);
  };

  return (
    <Shell workspaceId={workspaceId} project={project}>
      <header className="fm-page-head">
        <span className="fm-page-space">{project.iconEmoji} {project.name}</span>
        <h1 className="fm-page-title">{form.name}</h1>
        {form.description && <p className="fm-page-desc">{form.description}</p>}
      </header>

      <div className="fm-page-card">
        {created ? (
          <div className="fm-success" role="status">
            <span className="fm-success-mark" aria-hidden="true">✓</span>
            <h2 className="fm-success-title">Thanks, your request is in</h2>
            <span className="fm-success-key">Created as <strong>{created.key}</strong>: {created.summary}</span>
            <div className="fm-success-actions">
              <button type="button" className="btn btn-primary" onClick={() => useItemPanel.getState().openItem(created.id)}>Open {created.key}</button>
              <button type="button" className="btn" onClick={reset}>Submit another</button>
            </div>
          </div>
        ) : !form.active ? (
          <p className="fm-notice" role="status">This form is closed and is not accepting new requests.</p>
        ) : (
          <form className="fm-form" onSubmit={onSubmit} noValidate>
            {form.fields.map((f) => (
              <FieldInput key={f.id} field={f} value={values[f.id] ?? ''} error={errors[f.id]} people={people} onChange={(v) => setValue(f.id, v)} />
            ))}
            {submitError && <div className="fm-error" role="alert">{submitError}</div>}
            <div className="fm-page-foot">
              <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit'}</button>
            </div>
          </form>
        )}
      </div>
    </Shell>
  );
}

function FieldInput({ field, value, error, people, onChange }: {
  field: FormField;
  value: string;
  error?: string;
  people: { id: string; displayName: string; fullName: string }[];
  onChange(v: string): void;
}) {
  const id = `ff-${field.id}`;
  const errId = `${id}-err`;
  const invalid = Boolean(error);
  const cls = `input${invalid ? ' fm-input-error' : ''}`;

  let control;
  switch (field.type) {
    case 'textarea':
      control = <textarea id={id} className={cls} rows={5} maxLength={10000} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} aria-describedby={invalid ? errId : undefined} />;
      break;
    case 'select':
      control = (
        <select id={id} className={cls} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} aria-describedby={invalid ? errId : undefined}>
          <option value="">Choose…</option>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
      break;
    case 'date':
      control = <input id={id} type="date" className={cls} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} aria-describedby={invalid ? errId : undefined} />;
      break;
    case 'user':
      control = (
        <select id={id} className={cls} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} aria-describedby={invalid ? errId : undefined}>
          <option value="">Choose a person…</option>
          {people.map((p) => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
        </select>
      );
      break;
    case 'priority':
      control = (
        <select id={id} className={cls} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} aria-describedby={invalid ? errId : undefined}>
          <option value="">Choose…</option>
          {PRIORITY_ORDER.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
      );
      break;
    default:
      control = <input id={id} type="text" className={cls} maxLength={2000} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} aria-describedby={invalid ? errId : undefined} />;
  }

  return (
    <div className="fm-label">
      <label htmlFor={id}>
        {field.label}
        {field.required && <span className="fm-req" aria-hidden="true"> *</span>}
      </label>
      {control}
      {error && <span id={errId} className="fm-error">{error}</span>}
    </div>
  );
}

function Shell({ workspaceId, project, children }: { workspaceId: string; project?: Project; children: ReactNode }) {
  return (
    <div className="fm-page">
      {project && <Link className="btn btn-sm btn-ghost" to={`/w/${workspaceId}/projects/p/${project.id}`} style={{ marginBottom: 12 }}>Back to {project.name}</Link>}
      {children}
    </div>
  );
}
