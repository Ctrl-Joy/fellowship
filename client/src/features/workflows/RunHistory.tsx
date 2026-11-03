import { useEffect, useState } from 'react';
import { useSession, displayName } from '../../store/session';
import { formatFull, timeAgo } from '../../lib/time';
import { STEP_INFO, wfApi, type RunDetail, type RunSummary, type Step, findStep, stepTitle } from './model';
import { useWorkflowRuns } from './store';

const STATUS_LABEL: Record<string, string> = {
  running: 'Running', waiting: 'Waiting', succeeded: 'Succeeded', failed: 'Failed', cancelled: 'Cancelled',
  interrupted: 'Interrupted', skipped: 'Skipped',
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`wf-status wf-status-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

function duration(a: number, b: number | null) {
  if (!b) return '';
  const ms = b - a;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3600_000).toFixed(1)} h`;
}

export function RunHistory({ workflowId, steps }: { workflowId: string; steps: Step[] }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useWorkflowRuns((s) => s.byId);
  const seq = useWorkflowRuns((s) => s.seq);

  useEffect(() => {
    let alive = true;
    wfApi.runs(workflowId).then((r) => { if (alive) setRuns(r.runs); }).catch((e) => setError(e.message));
    return () => { alive = false; };
  }, [workflowId, seq]);

  if (error) return <div className="form-error">{error}</div>;
  if (!runs) return <div className="muted wf-pad">Loading runs…</div>;
  if (!runs.length) return <div className="empty">No runs yet. Use <b>Test run</b> or publish the workflow.</div>;
  return (
    <div className="wf-runs">
      {runs.map((r0) => {
        const r = live[r0.id] ?? r0;
        return (
          <div key={r.id} className={`wf-run${openId === r.id ? ' open' : ''}`}>
            <button type="button" className="wf-run-head" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
              <StatusPill status={r.status} />
              <span className="grow">
                {r.isTest && <span className="tag">Test</span>} Started {timeAgo(r.startedAt)}
                {r.triggerUserId && <> by <Who id={r.triggerUserId} /></>}
                <span className="muted"> · v{r.version} · {r.stepsCount} step{r.stepsCount === 1 ? '' : 's'}{r.finishedAt ? ` · ${duration(r.startedAt, r.finishedAt)}` : ''}</span>
              </span>
              {r.status === 'waiting' && r.wakeAt && <span className="muted">resumes {formatFull(r.wakeAt)}</span>}
            </button>
            {r.error && <div className="wf-run-error">{r.error}</div>}
            {openId === r.id && <RunDetailView runId={r.id} steps={steps} seq={seq} />}
          </div>
        );
      })}
    </div>
  );
}

function Who({ id }: { id: string }) {
  const m = useSession((s) => s.members[id]);
  return <b>{displayName(m)}</b>;
}

function RunDetailView({ runId, steps, seq }: { runId: string; steps: Step[]; seq: number }) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { wfApi.runDetail(runId).then((r) => setRun(r.run)).catch(() => {}); }, [runId, seq]);
  if (!run) return <div className="muted wf-pad">Loading…</div>;
  return (
    <div className="wf-run-body">
      {run.steps.length === 0 && <div className="muted">No steps ran.</div>}
      <ol className="wf-steplog">
        {run.steps.map((s) => {
          const def = findStep(steps, s.stepId);
          return (
            <li key={s.id} className={`wf-steplog-${s.status}`}>
              <div className="wf-inline">
                <StatusPill status={s.status} />
                <b>{STEP_INFO[s.type]?.icon} {def ? stepTitle(def) : STEP_INFO[s.type]?.label}</b>
                <code className="muted">{s.stepId}</code>
                <span className="grow" />
                <span className="muted">{new Date(s.startedAt).toLocaleTimeString()}{s.finishedAt ? ` · ${duration(s.startedAt, s.finishedAt)}` : ''}</span>
              </div>
              {s.error && <div className="wf-run-error">{s.error}</div>}
              {(s.output || s.input) && (
                <details>
                  <summary>Input &amp; output</summary>
                  {s.input && <pre className="wf-json">{JSON.stringify(s.input, null, 2)}</pre>}
                  {s.output && <pre className="wf-json">{JSON.stringify(s.output, null, 2)}</pre>}
                </details>
              )}
            </li>
          );
        })}
      </ol>
      {(run.status === 'running' || run.status === 'waiting') && (
        <button className="btn btn-sm btn-danger-ghost" disabled={busy} onClick={async () => {
          setBusy(true);
          try { setRun((await wfApi.cancelRun(run.id)).run); } finally { setBusy(false); }
        }}>Cancel run</button>
      )}
    </div>
  );
}
