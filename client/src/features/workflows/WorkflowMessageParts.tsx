import { useMemo, useState } from 'react';
import type { Conversation, Message, User } from '../../types';
import { useSession, displayName } from '../../store/session';
import { useMessages } from '../../store/messages';
import { Modal } from '../../components/Modal';
import { formatFull } from '../../lib/time';
import { wfApi, type FormField } from './model';
import './workflows.css';

export interface WorkflowMessagePartsProps {
  message: Message;
  conversation: Conversation;
  currentUser: User;
}

/** Interactive parts for workflow messages: form launcher, approve/deny buttons, provenance line. */
export default function WorkflowMessageParts({ message, currentUser }: WorkflowMessagePartsProps) {
  const meta = message.meta;
  if (!meta || message.deletedAt) return null;
  if (message.subtype === 'workflow_form' && meta.kind === 'form') return <FormPart message={message} me={currentUser} />;
  if (message.subtype === 'workflow_approval' && meta.kind === 'approval') return <ApprovalPart message={message} me={currentUser} />;
  if (meta.workflow?.name) {
    return <div className="wf-provenance">{meta.workflow.emoji || '⚡'} Sent by the workflow <b>{meta.workflow.name}</b></div>;
  }
  return null;
}

function FormPart({ message, me }: { message: Message; me: User }) {
  const meta = message.meta;
  const [open, setOpen] = useState(false);
  const responded = (meta.respondedUserIds ?? []).includes(me.id);
  const closed = !!meta.closed;
  const canSubmit = !closed && (!responded || meta.allowMultiple);
  const count = meta.responseCount ?? 0;
  return (
    <div className="wf-card">
      <div className="wf-card-row">
        <span className="wf-card-icon">📝</span>
        <div className="grow">
          <div className="wf-card-title">{meta.title}</div>
          <div className="wf-card-sub">
            {meta.fields?.length ?? 0} question{meta.fields?.length === 1 ? '' : 's'}
            {count > 0 && <> · {count} response{count === 1 ? '' : 's'}</>}
            {meta.workflow?.name && <> · from <b>{meta.workflow.name}</b></>}
          </div>
        </div>
        {closed ? <span className="wf-pill wf-pill-muted">Closed</span>
          : responded && !meta.allowMultiple ? <span className="wf-pill wf-pill-ok">✓ Submitted</span>
          : null}
        {canSubmit && (
          <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
            {responded ? 'Submit another' : 'Open form'}
          </button>
        )}
      </div>
      {open && <FormModal message={message} onClose={() => setOpen(false)} />}
    </div>
  );
}

function FormModal({ message, onClose }: { message: Message; onClose(): void }) {
  const meta = message.meta;
  const fields: FormField[] = meta.fields ?? [];
  const members = useSession((s) => s.members);
  const people = useMemo(() => Object.values(members).filter((m) => !m.deactivated && !m.isBot)
    .sort((a, b) => displayName(a).localeCompare(displayName(b))), [members]);
  const [values, setValues] = useState<Record<string, any>>(() =>
    Object.fromEntries(fields.map((f) => [f.id, f.type === 'multi_select' ? [] : ''])));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (id: string, v: any) => setValues((s) => ({ ...s, [id]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    for (const f of fields) {
      const v = values[f.id];
      if (f.required && (v === '' || v == null || (Array.isArray(v) && !v.length))) { setError(`"${f.label}" is required`); return; }
    }
    setBusy(true); setError(null);
    try {
      await wfApi.submitForm(message.id, values);
      // optimistic: mark as responded; the server's message.updated confirms
      const me = useSession.getState().me!;
      useMessages.getState().patch(message.id, {
        meta: { ...meta, responseCount: (meta.responseCount ?? 0) + 1, respondedUserIds: [...new Set([...(meta.respondedUserIds ?? []), me.id])] },
      });
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={meta.title} onClose={onClose} width={520}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" form={`wf-form-${message.id}`} className="btn btn-primary" disabled={busy}>{meta.submitLabel || 'Submit'}</button>
      </>}>
      <form id={`wf-form-${message.id}`} className="wf-form" onSubmit={submit}>
        {fields.map((f) => (
          <label key={f.id} className="field">
            <span>{f.label}{f.required && <span className="wf-req"> *</span>}</span>
            {f.type === 'short_text' && <input className="input" value={values[f.id]} placeholder={f.placeholder} maxLength={500} onChange={(e) => set(f.id, e.target.value)} />}
            {f.type === 'long_text' && <textarea className="input" rows={3} value={values[f.id]} placeholder={f.placeholder} maxLength={4000} onChange={(e) => set(f.id, e.target.value)} />}
            {f.type === 'number' && <input className="input" type="number" step="any" value={values[f.id]} onChange={(e) => set(f.id, e.target.value)} />}
            {f.type === 'date' && <input className="input" type="date" value={values[f.id]} onChange={(e) => set(f.id, e.target.value)} />}
            {f.type === 'select' && (
              <select className="input" value={values[f.id]} onChange={(e) => set(f.id, e.target.value)}>
                <option value="">Choose…</option>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {f.type === 'multi_select' && (
              <div className="wf-checks">
                {(f.options ?? []).map((o) => (
                  <label key={o} className="wf-check">
                    <input type="checkbox" checked={values[f.id].includes(o)}
                      onChange={(e) => set(f.id, e.target.checked ? [...values[f.id], o] : values[f.id].filter((x: string) => x !== o))} />
                    {o}
                  </label>
                ))}
              </div>
            )}
            {f.type === 'user' && (
              <select className="input" value={values[f.id]} onChange={(e) => set(f.id, e.target.value)}>
                <option value="">Choose a person…</option>
                {people.map((p) => <option key={p.id} value={p.id}>{displayName(p)}{p.fullName && p.fullName !== p.displayName ? ` (${p.fullName})` : ''}</option>)}
              </select>
            )}
          </label>
        ))}
        {error && <div className="form-error">{error}</div>}
      </form>
    </Modal>
  );
}

function ApprovalPart({ message, me }: { message: Message; me: User }) {
  const meta = message.meta;
  const members = useSession((s) => s.members);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isApprover = meta.approverId === me.id;
  const pending = meta.status === 'pending' && !meta.closed;

  async function decide(decision: 'approve' | 'deny') {
    setBusy(true); setError(null);
    try {
      await wfApi.decide(message.id, decision, note.trim());
      useMessages.getState().patch(message.id, {
        meta: { ...meta, status: decision === 'approve' ? 'approved' : 'denied', decidedBy: me.id, decidedAt: Date.now(), note: note.trim() },
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const statusPill = meta.status === 'approved' ? <span className="wf-pill wf-pill-ok">Approved</span>
    : meta.status === 'denied' ? <span className="wf-pill wf-pill-bad">Denied</span>
    : meta.status === 'cancelled' || meta.closed ? <span className="wf-pill wf-pill-muted">Withdrawn</span>
    : <span className="wf-pill wf-pill-wait">Waiting for {isApprover ? 'you' : displayName(members[meta.approverId])}</span>;

  return (
    <div className="wf-card">
      <div className="wf-card-row">
        <span className="wf-card-icon">🛂</span>
        <div className="grow">
          <div className="wf-card-title">Approval request</div>
          {meta.decidedBy && meta.decidedAt && (
            <div className="wf-card-sub">
              {meta.status === 'approved' ? 'Approved' : 'Denied'} by <b>{displayName(members[meta.decidedBy])}</b> · {formatFull(meta.decidedAt)}
              {meta.note && <> — “{meta.note}”</>}
            </div>
          )}
        </div>
        {statusPill}
      </div>
      {pending && isApprover && (
        <div className="wf-approval-actions">
          {noting && (
            <input className="input" placeholder="Add a note (optional)" value={note} maxLength={1000} autoFocus
              onChange={(e) => setNote(e.target.value)} />
          )}
          <div className="wf-btn-row">
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => decide('approve')}>Approve</button>
            <button className="btn btn-sm btn-danger-ghost" disabled={busy} onClick={() => decide('deny')}>Deny</button>
            {!noting && <button className="btn btn-ghost btn-sm" onClick={() => setNoting(true)}>Add note</button>}
          </div>
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
