import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Modal } from './Modal';

/**
 * In-app replacements for window.confirm / window.prompt / window.alert.
 * Call askConfirm / askText / tell from anywhere; <DialogHost /> renders the open one.
 */
type Request =
  | { kind: 'confirm'; title: string; body?: string; action: string; danger: boolean; done(ok: boolean): void }
  | { kind: 'text'; title: string; label: string; initial: string; action: string; done(value: string | null): void }
  | { kind: 'tell'; title: string; body?: string; done(): void };

let current: Request | null = null;
const listeners = new Set<() => void>();
const set = (r: Request | null) => { current = r; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Ask a yes/no question. Resolves true only when the person confirms. */
export function askConfirm(title: string, opts: { body?: string; action?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => set({
    kind: 'confirm', title, body: opts.body, action: opts.action ?? 'Confirm', danger: opts.danger ?? false,
    done: (ok) => { set(null); resolve(ok); },
  }));
}

/** Ask for one line of text. Resolves null when cancelled or left empty. */
export function askText(title: string, opts: { label?: string; initial?: string; action?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => set({
    kind: 'text', title, label: opts.label ?? title, initial: opts.initial ?? '', action: opts.action ?? 'Save',
    done: (v) => { set(null); resolve(v); },
  }));
}

/** Show a message the person has to acknowledge (for errors with no better home). */
export function tell(title: string, body?: string): Promise<void> {
  return new Promise((resolve) => set({ kind: 'tell', title, body, done: () => { set(null); resolve(); } }));
}

export function DialogHost() {
  const req = useSyncExternalStore(subscribe, () => current);
  if (!req) return null;
  if (req.kind === 'text') return <TextDialog req={req} />;
  const cancel = () => (req.kind === 'confirm' ? req.done(false) : req.done());
  return (
    <Modal title={req.title} onClose={cancel} width={420} className="dialog"
      footer={req.kind === 'confirm'
        ? <><button className="btn" onClick={cancel}>Cancel</button><button className={`btn ${req.danger ? 'btn-danger' : 'btn-primary'}`} autoFocus onClick={() => req.done(true)}>{req.action}</button></>
        : <button className="btn btn-primary" autoFocus onClick={cancel}>OK</button>}>
      {req.body ? <p className="dialog-text">{req.body}</p> : null}
    </Modal>
  );
}

function TextDialog({ req }: { req: Extract<Request, { kind: 'text' }> }) {
  const [value, setValue] = useState(req.initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const clean = value.trim();
  return (
    <Modal title={req.title} onClose={() => req.done(null)} width={420} className="dialog">
      <form onSubmit={(e) => { e.preventDefault(); if (clean) req.done(clean); }}>
        <input ref={ref} className="input" aria-label={req.label} value={value} maxLength={120} onChange={(e) => setValue(e.target.value)} />
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => req.done(null)}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!clean}>{req.action}</button>
        </div>
      </form>
    </Modal>
  );
}
