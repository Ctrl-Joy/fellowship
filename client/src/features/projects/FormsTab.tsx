import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { projectsApi } from './api';
import { useProjects } from './store';
import type { FormTemplate, ProjectForm } from './types';
import { TYPE_LABEL } from './types';
import type { TabProps } from './tabTypes';
import { absoluteUrl, copyText } from './support';
import FormBuilder from './FormBuilder';
import './forms.css';

type BuilderState = { form?: ProjectForm; template?: FormTemplate } | null;

export default function FormsTab({ workspaceId, project }: TabProps) {
  const version = useProjects((s) => s.version);
  const [forms, setForms] = useState<ProjectForm[] | null>(null);
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [builder, setBuilder] = useState<BuilderState>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => { setForms(null); }, [project.id]);
  useEffect(() => {
    let alive = true;
    projectsApi.forms(project.id)
      .then((r) => { if (alive) { setForms(r.forms); setTemplates(r.templates); setLoadError(null); } })
      .catch((e: Error) => { if (alive) setLoadError(e.message); });
    return () => { alive = false; };
  }, [project.id, version]);

  const formPath = (id: string) => `/w/${workspaceId}/projects/form/${id}`;

  const copyLink = async (f: ProjectForm) => {
    if (await copyText(absoluteUrl(formPath(f.id)))) {
      setCopied(f.id);
      setTimeout(() => setCopied((c) => (c === f.id ? null : c)), 1600);
    }
  };

  const toggleActive = async (f: ProjectForm) => {
    setRowError(null);
    try {
      const next = await projectsApi.updateForm(f.id, { active: !f.active });
      setForms((list) => list?.map((x) => (x.id === f.id ? next : x)) ?? list);
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Could not update the form');
    }
  };

  const remove = async (f: ProjectForm) => {
    if (!window.confirm(`Delete the form "${f.name}"? Work items it already created are kept.`)) return;
    setRowError(null);
    try {
      await projectsApi.deleteForm(f.id);
      setForms((list) => list?.filter((x) => x.id !== f.id) ?? list);
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Could not delete the form');
    }
  };

  const onSaved = (saved: ProjectForm) => {
    setForms((list) => {
      if (!list) return [saved];
      return list.some((x) => x.id === saved.id) ? list.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...list];
    });
    setBuilder(null);
  };

  return (
    <div className="fm">
      <section className="fm-intro">
        <div className="fm-intro-text">
          <h2 className="fm-title">Forms</h2>
          <p className="fm-sub">
            Forms let anyone in the workspace ask this space for work without opening it. Each submission becomes a work item
            here, already filled in and assigned to the right person.
          </p>
        </div>
        <div className="fm-flow" aria-hidden="true">
          <div className="fm-flow-step"><span className="fm-flow-num">1</span> Share a form</div>
          <svg className="fm-flow-arrow" width="22" height="16" viewBox="0 0 22 16"><path d="M1 8h18m-5-6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <div className="fm-flow-step"><span className="fm-flow-num">2</span> Requests land on your board
            <span className="fm-flow-board"><span /><span /><span /></span>
          </div>
        </div>
      </section>

      <section>
        <h3 className="fm-section-title">Create a new form</h3>
        <div className="fm-templates">
          <button type="button" className="fm-template" onClick={() => setBuilder({ template: templates.find((t) => t.id === 'blank') })}>
            <span className="fm-template-name">Blank form</span>
            <span className="fm-template-desc">Start from a title and a description.</span>
          </button>
          {templates.filter((t) => t.id !== 'blank').map((t) => (
            <button key={t.id} type="button" className="fm-template" onClick={() => setBuilder({ template: t })}>
              <span className="fm-template-name">{t.name}</span>
              <span className="fm-template-desc">{t.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="fm-section-title">Forms in this space</h3>
        {loadError && <div className="fm-notice">{loadError}</div>}
        {rowError && <p className="fm-row-error" role="alert">{rowError}</p>}
        {!forms && !loadError && <div className="fm-loading">Loading forms…</div>}
        {forms && forms.length === 0 && (
          <div className="fm-empty">No forms yet. Create one from a template above. Each submission becomes a work item in this space.</div>
        )}
        {forms && forms.length > 0 && (
          <ul className="fm-list">
            {forms.map((f) => (
              <li key={f.id} className="fm-row">
                <div className="fm-row-main">
                  <div className="fm-row-name">{f.name}</div>
                  <div className="fm-row-desc">{f.description || `${f.fields.length} fields`}</div>
                </div>
                <span className="fm-chip">{TYPE_LABEL[f.itemType]}</span>
                <span className="fm-count">{f.submissions} {f.submissions === 1 ? 'submission' : 'submissions'}</span>
                <label className="fm-switch">
                  <input type="checkbox" role="switch" aria-label={`Accepting submissions for ${f.name}`} checked={f.active}
                    onChange={() => toggleActive(f)} />
                  {f.active ? 'Open' : 'Closed'}
                </label>
                <div className="fm-actions">
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => copyLink(f)}>{copied === f.id ? 'Copied' : 'Copy link'}</button>
                  <Link className="btn btn-sm btn-ghost" to={formPath(f.id)}>Open</Link>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setBuilder({ form: f })}>Edit</button>
                  <button type="button" className="btn btn-sm btn-ghost btn-danger-ghost" onClick={() => remove(f)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {builder && (
        <FormBuilder
          projectId={project.id}
          form={builder.form}
          template={builder.template}
          onSaved={onSaved}
          onClose={() => setBuilder(null)}
        />
      )}
    </div>
  );
}
