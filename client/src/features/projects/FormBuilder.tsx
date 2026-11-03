import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Icon } from '../../components/Icon';
import { projectsApi } from './api';
import type { FieldType, FormField, FormTemplate, ItemType, ProjectForm } from './types';
import { TYPE_LABEL, TYPE_ORDER, PRIORITY_LABEL, PRIORITY_ORDER } from './types';
import './forms.css';

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: 'Short text', textarea: 'Long text', select: 'Choice', date: 'Date', user: 'Person', priority: 'Priority',
};
type MapTo = NonNullable<FormField['mapTo']>;
const MAP_LABEL: Record<MapTo, string> = { summary: 'Work item title', description: 'Description', priority: 'Priority', dueDate: 'Due date', assignee: 'Assignee' };
/** Targets that only one field may fill in. */
const SINGLE: MapTo[] = ['summary', 'priority', 'dueDate', 'assignee'];
/** Which targets make sense for each field type. */
const ALLOWED: Record<FieldType, MapTo[]> = {
  text: ['summary', 'description'],
  textarea: ['description'],
  select: ['description'],
  date: ['dueDate', 'description'],
  user: ['assignee', 'description'],
  priority: ['priority', 'description'],
};

export function newFieldId() {
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function blankField(): FormField {
  return { id: newFieldId(), label: '', type: 'text', required: false, options: [], mapTo: 'summary' };
}

/** Problems that stop the form from being saved. */
function validate(name: string, fields: FormField[]): string[] {
  const out: string[] = [];
  if (!name.trim()) out.push('Give the form a name.');
  if (!fields.length) out.push('Add at least one field.');
  fields.forEach((f, i) => {
    const where = f.label.trim() || `Field ${i + 1}`;
    if (!f.label.trim()) out.push(`Field ${i + 1} needs a label.`);
    if (f.type === 'select' && !f.options.some((o) => o.trim())) out.push(`${where} needs at least one option.`);
  });
  const summaries = fields.filter((f) => f.mapTo === 'summary').length;
  if (summaries !== 1) out.push('Exactly one field must fill in the work item title.');
  return out;
}

interface Props {
  projectId: string;
  /** Editing an existing form. */
  form?: ProjectForm;
  /** Starting from a template (new form). */
  template?: FormTemplate;
  onSaved(form: ProjectForm): void;
  onClose(): void;
}

export default function FormBuilder({ projectId, form, template, onSaved, onClose }: Props) {
  const [name, setName] = useState(form?.name ?? template?.name ?? '');
  const [description, setDescription] = useState(form?.description ?? template?.description ?? '');
  const [itemType, setItemType] = useState<ItemType>(form?.itemType ?? template?.itemType ?? 'task');
  const [fields, setFields] = useState<FormField[]>(() => {
    const src = form?.fields ?? template?.fields ?? [];
    return src.length ? src.map((f) => ({ ...f, options: [...f.options] })) : [blankField()];
  });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problems = validate(name, fields);

  const patchField = (id: string, patch: Partial<FormField>) =>
    setFields((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const setType = (id: string, type: FieldType) =>
    setFields((fs) => fs.map((f) => {
      if (f.id !== id) return f;
      const mapTo = f.mapTo && ALLOWED[type].includes(f.mapTo) ? f.mapTo : null;
      return { ...f, type, mapTo, options: type === 'select' ? f.options : [] };
    }));

  const setMap = (id: string, mapTo: MapTo | null) =>
    setFields((fs) => fs.map((f) => {
      if (f.id === id) return { ...f, mapTo };
      // A single-target field moves from the field that held it.
      if (mapTo && SINGLE.includes(mapTo) && f.mapTo === mapTo) return { ...f, mapTo: null };
      return f;
    }));

  const move = (index: number, delta: number) => {
    const j = index + delta;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[index], next[j]] = [next[j], next[index]];
    setFields(next);
  };

  const remove = (id: string) => setFields((fs) => fs.filter((f) => f.id !== id));
  const add = () => setFields((fs) => [...fs, blankField()]);

  const save = async () => {
    setTried(true);
    if (validate(name, fields).length) return;
    const cleaned = fields.map((f) => ({
      ...f,
      label: f.label.trim(),
      options: f.type === 'select' ? f.options.map((o) => o.trim()).filter(Boolean) : [],
    }));
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), description: description.trim(), itemType, fields: cleaned };
      const saved = form
        ? await projectsApi.updateForm(form.id, body)
        : await projectsApi.createForm(projectId, { ...body, template: template?.id });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the form');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={form ? 'Edit form' : 'New form'}
      onClose={onClose}
      width={720}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : form ? 'Save changes' : 'Create form'}
          </button>
        </>
      )}
    >
      <div className="fm-form">
        <label className="fm-label">
          Name
          <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Customer feedback" />
        </label>
        <label className="fm-label">
          Description
          <textarea className="input" rows={2} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)}
            placeholder="Shown to people before they fill in the form" />
        </label>
        <label className="fm-label">
          Work item type
          <select className="input" value={itemType} onChange={(e) => setItemType(e.target.value as ItemType)}>
            {TYPE_ORDER.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
          <span className="fm-hint">Each submission creates a work item of this type.</span>
        </label>

        <div>
          <div className="fm-fields-head">
            <span className="fm-section-title">Fields</span>
            <button type="button" className="btn btn-sm" onClick={add}><Icon name="plus" size={14} /> Add field</button>
          </div>
          <span className="fm-hint">
            Each field fills in part of the new work item. Exactly one field must fill in the title; a field that fills in a single-value
            target (title, priority, due date, assignee) takes it from any other field.
          </span>
        </div>

        {fields.map((f, i) => (
          <div className="fm-field" key={f.id}>
            <div className="fm-field-top">
              <input className="input fm-field-label" aria-label={`Field ${i + 1} label`} value={f.label} maxLength={120}
                placeholder="Question or label" onChange={(e) => patchField(f.id, { label: e.target.value })} />
              <select className="input" aria-label={`Field ${i + 1} type`} value={f.type} onChange={(e) => setType(f.id, e.target.value as FieldType)}>
                {(Object.keys(FIELD_TYPE_LABEL) as FieldType[]).map((t) => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}
              </select>
              <label className="fm-check">
                <input type="checkbox" checked={f.required} onChange={(e) => patchField(f.id, { required: e.target.checked })} /> Required
              </label>
              <div className="fm-field-moves">
                <button type="button" className="icon-btn" aria-label={`Move field ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
                <button type="button" className="icon-btn" aria-label={`Move field ${i + 1} down`} disabled={i === fields.length - 1} onClick={() => move(i, 1)}>▼</button>
                <button type="button" className="icon-btn" aria-label={`Remove field ${i + 1}`} onClick={() => remove(f.id)}><Icon name="x" size={14} /></button>
              </div>
            </div>
            <div className="fm-field-bottom">
              <label className="fm-small">
                Fills in
                <select className="input" aria-label={`Field ${i + 1} fills in`} value={f.mapTo ?? ''}
                  onChange={(e) => setMap(f.id, (e.target.value || null) as MapTo | null)}>
                  <option value="">Nothing (shown in the description)</option>
                  {ALLOWED[f.type].map((m) => <option key={m} value={m}>{MAP_LABEL[m]}</option>)}
                </select>
              </label>
              {f.type === 'priority' && <span className="fm-hint">Choices: {PRIORITY_ORDER.map((p) => PRIORITY_LABEL[p]).join(', ')}</span>}
              {f.type === 'select' && (
                <label className="fm-small fm-grow">
                  Options (one per line)
                  <textarea className="input" rows={3} aria-label={`Field ${i + 1} options`} value={f.options.join('\n')}
                    onChange={(e) => patchField(f.id, { options: e.target.value.split('\n') })} />
                </label>
              )}
            </div>
          </div>
        ))}

        {tried && problems.length > 0 && (
          <div className="fm-errors" role="alert">
            <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
        {error && <div className="fm-error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
