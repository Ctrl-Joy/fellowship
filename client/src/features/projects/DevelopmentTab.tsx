import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { projectsApi } from './api';
import { useProjects } from './store';
import type { DevData } from './types';
import type { TabProps } from './tabTypes';
import { absoluteUrl, copyText, fmtDateTime, fmtDay } from './support';
import './dev.css';

type Section = 'connections' | 'pulls' | 'repos' | 'vulns' | 'deploys';
const SECTIONS: [Section, string][] = [
  ['connections', 'Connections'], ['pulls', 'Pull requests'], ['repos', 'Repositories'], ['vulns', 'Vulnerabilities'], ['deploys', 'Deployments'],
];

const CONNECTORS = [
  { name: 'GitHub', text: 'Forward pull request, deployment and repository events from a repository webhook or a workflow step.' },
  { name: 'GitLab', text: 'Forward merge request, pipeline deployment and security finding events from a project webhook or CI job.' },
  { name: 'Bitbucket', text: 'Forward pull request and deployment events from a repository webhook or a pipeline step.' },
  { name: 'Other tool', text: 'Anything that can send an HTTPS POST with a JSON body can feed this space.' },
];

/** Hours as "35 min", "5.2 h" or "2.4 days"; "—" when there is no data yet. */
export function formatHours(h: number | null | undefined): string {
  if (h == null) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

/** Completed work items per day over the last week. */
function Sparkline({ values }: { values: number[] }) {
  if (!values.length) return null;
  const w = 120, h = 36, pad = 3;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const pts = values.map((v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1][0].toFixed(1);
  const first = pts[0][0].toFixed(1);
  const area = `${line} L${last} ${h} L${first} ${h} Z`;
  return (
    <svg className="dv-spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Completed per day over the last ${values.length} days: ${values.join(', ')}`}>
      <path d={area} className="dv-spark-area" />
      <path d={line} className="dv-spark-line" fill="none" />
      {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === pts.length - 1 ? 2.5 : 1.5} className="dv-spark-dot" />)}
    </svg>
  );
}

/** Example payloads for the incoming hook, using the space's own key. */
function examplePayloads(projectKey: string) {
  return [
    { title: 'Pull request', body: { type: 'pull_request', id: '142', action: 'opened', title: 'Add login rate limit', repo: 'web-app', author: 'ava', url: 'https://code.example.com/web-app/pull/142', itemKeys: [`${projectKey}-12`] } },
    { title: 'Deployment', body: { type: 'deployment', id: 'deploy-881', environment: 'production', status: 'success', prIds: ['142'] } },
    { title: 'Vulnerability', body: { type: 'vulnerability', id: 'vuln-7', title: 'Outdated parser dependency', severity: 'high', status: 'open' } },
    { title: 'Repository', body: { type: 'repository', id: 'repo-web-app', name: 'web-app' } },
  ];
}

export default function DevelopmentTab({ workspaceId, project }: TabProps) {
  const version = useProjects((s) => s.version);
  const [data, setData] = useState<DevData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('connections');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => { setData(null); }, [project.id]);
  useEffect(() => {
    let alive = true;
    projectsApi.development(project.id)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [project.id, version]);

  if (!data) return <div className={error ? 'dv-error' : 'dv-loading'}>{error ?? 'Loading development data…'}</div>;

  const m = data.metrics;
  const hookUrl = absoluteUrl(data.hookPath);
  const listUrl = `/w/${workspaceId}/projects/p/${project.id}/list`;
  const copy = async (text: string, key: string) => {
    if (await copyText(text)) {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    }
  };

  return (
    <div className="dv">
      <section>
        <h2 className="dv-section-title">Key metrics</h2>
        <p className="dv-section-sub">Computed from this space's work items and from code-host events it has received.</p>
        <div className="dv-metrics">
          <div className="dv-metric">
            <span className="dv-metric-label">Work items completed this week</span>
            <div className="dv-metric-row">
              <span className="dv-metric-value">{m.completedThisWeek}</span>
              <Sparkline values={m.completedSeries} />
            </div>
            <span className="dv-metric-desc">Items moved to Done in the last 7 days.</span>
            <Link className="dv-metric-link" to={listUrl}>View work items</Link>
          </div>
          <div className="dv-metric">
            <span className="dv-metric-label">Pull request cycle time</span>
            <span className="dv-metric-value">{formatHours(m.prCycleTimeHours)}</span>
            <span className="dv-metric-desc">Rolling 7-day median from a pull request opening to merging.</span>
          </div>
          <div className="dv-metric">
            <span className="dv-metric-label">Lead time for changes</span>
            <span className="dv-metric-value">{formatHours(m.leadTimeHours)}</span>
            <span className="dv-metric-desc">Rolling 12-week median from merge to a successful deployment.</span>
          </div>
          <div className="dv-metric">
            <span className="dv-metric-label">Overdue work items</span>
            <span className={`dv-metric-value${m.overdue ? ' is-alert' : ''}`}>{m.overdue}</span>
            <span className="dv-metric-desc">Open items whose due date has passed.</span>
            <Link className="dv-metric-link" to={listUrl}>View work items</Link>
          </div>
          <div className="dv-metric">
            <span className="dv-metric-label">Reopened work items</span>
            <span className="dv-metric-value">{m.reopened}</span>
            <span className="dv-metric-desc">Items that moved back out of Done at least once.</span>
            <Link className="dv-metric-link" to={listUrl}>View work items</Link>
          </div>
          <div className="dv-metric">
            <span className="dv-metric-label">Open bugs</span>
            <span className="dv-metric-value">{m.bugsOpen}</span>
            <span className="dv-metric-desc">Bug items that are not Done yet.</span>
            <Link className="dv-metric-link" to={listUrl}>View bugs</Link>
          </div>
          <div className="dv-metric">
            <span className="dv-metric-label">Open pull requests</span>
            <span className="dv-metric-value">{m.prsOpen}</span>
            <span className="dv-metric-desc">Pull requests reported as open by a connected code host.</span>
          </div>
          <div className="dv-metric">
            <span className="dv-metric-label">Critical vulnerabilities</span>
            <span className={`dv-metric-value${m.criticalVulnerabilities ? ' is-alert' : ''}`}>{m.criticalVulnerabilities}</span>
            <span className="dv-metric-desc">Critical findings that are not marked fixed.</span>
          </div>
        </div>
      </section>

      <section>
        <div className="dv-tabs" role="tablist" aria-label="Development sections">
          {SECTIONS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={section === key} className="dv-tab" onClick={() => setSection(key)}>{label}</button>
          ))}
        </div>

        {section === 'connections' && (
          <>
            <h2 className="dv-section-title">Connections</h2>
            <p className="dv-section-sub">Connect a code host or CI tool so pull requests, deployments and findings show up here.</p>
            <div className="dv-connectors">
              {CONNECTORS.map((c) => (
                <div key={c.name} className="dv-connector">
                  <span className="dv-connector-name">{c.name}</span>
                  <span className="dv-connector-text">{c.text}</span>
                </div>
              ))}
            </div>
            <div className="dv-hook">
              <span className="dv-section-title">Webhook URL for this space</span>
              <p className="dv-note">
                Send JSON events with a POST request to this URL. Anyone with the link can post events to this space, so keep it private.
                Put a work item key such as {project.key}-12 in <code>itemKeys</code> to link a pull request to it.
              </p>
              <div className="dv-hook-row">
                <code className="dv-hook-url">{hookUrl}</code>
                <button type="button" className="btn btn-sm" onClick={() => copy(hookUrl, 'hook')}>{copied === 'hook' ? 'Copied' : 'Copy URL'}</button>
              </div>
              {examplePayloads(project.key).map((ex) => {
                const cmd = `curl -X POST '${hookUrl}' -H 'Content-Type: application/json' -d '${JSON.stringify(ex.body)}'`;
                return (
                  <div key={ex.title} className="dv-example">
                    <div className="dv-hook-row">
                      <span className="dv-example-title">{ex.title} event</span>
                      <span style={{ flex: 1 }} />
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => copy(cmd, ex.title)}>{copied === ex.title ? 'Copied' : 'Copy example'}</button>
                    </div>
                    <pre className="dv-code">{cmd}</pre>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {section === 'pulls' && (
          <>
            <h2 className="dv-section-title">Pull requests</h2>
            <p className="dv-section-sub">Pull requests reported by connected code hosts.</p>
            {data.pullRequests.length === 0 ? (
              <div className="dv-empty">No pull requests yet. Connect a code host to see them here.</div>
            ) : (
              <div className="dv-table-wrap">
                <table className="dv-table">
                  <thead><tr><th>Title</th><th>Repository</th><th>Author</th><th>State</th><th>Opened</th><th>Merged</th></tr></thead>
                  <tbody>
                    {data.pullRequests.map((pr) => (
                      <tr key={pr.ref}>
                        <td className="dv-title-cell">{pr.url ? <a href={pr.url} target="_blank" rel="noreferrer">{pr.title || pr.ref}</a> : (pr.title || pr.ref)}</td>
                        <td>{pr.repo || <span className="dv-cell-muted">—</span>}</td>
                        <td>{pr.author || <span className="dv-cell-muted">—</span>}</td>
                        <td><span className={`dv-badge dv-badge-${pr.state}`}>{pr.state}</span></td>
                        <td>{fmtDay(pr.openedAt)}</td>
                        <td>{pr.mergedAt ? fmtDay(pr.mergedAt) : <span className="dv-cell-muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {section === 'repos' && (
          <>
            <h2 className="dv-section-title">Repositories</h2>
            <p className="dv-section-sub">Repositories that report to this space.</p>
            {data.repositories.length === 0 ? (
              <div className="dv-empty">No repositories connected yet. Send a repository event to add one.</div>
            ) : (
              <div className="dv-table-wrap">
                <ul className="dv-list">
                  {data.repositories.map((r) => (
                    <li key={r.ref} className="dv-list-item">
                      {r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.name}</a> : r.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {section === 'vulns' && (
          <>
            <h2 className="dv-section-title">Vulnerabilities</h2>
            <p className="dv-section-sub">Security findings reported for this space's code.</p>
            {data.vulnerabilities.length === 0 ? (
              <div className="dv-empty">No vulnerabilities reported. Findings from a scanner will appear here.</div>
            ) : (
              <div className="dv-table-wrap">
                <table className="dv-table">
                  <thead><tr><th>Finding</th><th>Severity</th><th>Status</th><th>Updated</th></tr></thead>
                  <tbody>
                    {data.vulnerabilities.map((v) => (
                      <tr key={v.ref}>
                        <td className="dv-title-cell">{v.url ? <a href={v.url} target="_blank" rel="noreferrer">{v.title || v.ref}</a> : (v.title || v.ref)}</td>
                        <td><span className={`dv-badge dv-badge-sev-${v.severity}`}>{v.severity}</span></td>
                        <td><span className={`dv-badge dv-badge-${v.status === 'fixed' ? 'fixed' : 'open'}`}>{v.status === 'fixed' ? 'Fixed' : 'Open'}</span></td>
                        <td>{fmtDay(v.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {section === 'deploys' && (
          <>
            <h2 className="dv-section-title">Deployments</h2>
            <p className="dv-section-sub">Deployments and the pull requests they shipped.</p>
            {data.deployments.length === 0 ? (
              <div className="dv-empty">No deployments yet. Deployment events will be listed here with their pull requests.</div>
            ) : (
              <div className="dv-table-wrap">
                <table className="dv-table">
                  <thead><tr><th>Environment</th><th>Status</th><th>Pull requests</th><th>Deployed</th></tr></thead>
                  <tbody>
                    {data.deployments.map((d) => (
                      <tr key={d.ref}>
                        <td>{d.url ? <a href={d.url} target="_blank" rel="noreferrer">{d.environment}</a> : d.environment}</td>
                        <td><span className={`dv-badge dv-badge-${d.status}`}>{d.status.replace('_', ' ')}</span></td>
                        <td>{d.prIds.length ? d.prIds.map((id) => `#${id}`).join(', ') : <span className="dv-cell-muted">None linked</span>}</td>
                        <td>{fmtDateTime(d.deployedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
