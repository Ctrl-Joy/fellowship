import { useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import type { TabProps } from './tabTypes';
import { useItemPanel } from './ui';
import { PeopleFilter } from './PeopleFilter';
import { EpicProgress, PriorityBars, RecentActivity, StatCards, StatusDonut, TeamWorkload, TypesOfWork, useSummary } from './widgets';
import './summary.css';

const BANNER_KEY = 'fellowship.projects.summaryBannerDismissed';
const RANGES = [7, 14, 30] as const;

function readDismissed() {
  try { return localStorage.getItem(BANNER_KEY) === '1'; } catch { return false; }
}

/** Space overview: live stats and charts computed on the server from the space's work and activity. */
export default function SummaryTab({ workspaceId, project }: TabProps) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const [people, setPeople] = useState<string[]>([]);
  const [days, setDays] = useState<number>(7);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const { summary, loading, error, stale } = useSummary(project.id, { days, assignee: people.length ? people : undefined });

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(BANNER_KEY, '1'); } catch { /* storage unavailable: dismiss for this session only */ }
  };
  const filtered = people.length > 0;
  const empty = summary && summary.total === 0 && !filtered;
  const create = () => useItemPanel.getState().openCreate({ projectId: project.id });
  const widgetProps = summary ? { summary, workspaceId, projectId: project.id } : null;

  return (
    <div className="pjs-root">
      {!dismissed && (
        <div className="pjs-banner" role="region" aria-label="Dashboards tip">
          <span className="pjs-banner-icon" aria-hidden="true"><Icon name="grid" size={20} /></span>
          <div className="pjs-banner-text">
            <strong>Build a dashboard for your team</strong>
            <span>Pick the widgets that matter, mix several spaces and saved filters, and share one view with everyone.</span>
          </div>
          <Link className="btn btn-sm btn-primary" to={`/w/${workspaceId}/projects/dashboards`}>Go to Dashboards</Link>
          <button type="button" className="icon-btn" onClick={dismiss} aria-label="Dismiss"><Icon name="x" size={16} /></button>
        </div>
      )}

      {!empty && (
        <div className="pjs-toolbar">
          <PeopleFilter selected={people} onChange={setPeople} />
          <div className="pjs-toolbar-spacer" />
          {loading && summary && <span className="pjs-loading-dot" aria-live="polite">Updating…</span>}
          <div className="pjs-range" role="group" aria-label="Date range">
            {RANGES.map((d) => (
              <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>
            ))}
          </div>
        </div>
      )}

      {error && <div className="pjs-error" role="alert">{error}</div>}

      {!summary && !error && (
        <div className="pjs-grid" aria-busy="true" aria-label="Loading summary">
          <div className="pjs-skel short" /><div className="pjs-skel" /><div className="pjs-skel" /><div className="pjs-skel" /><div className="pjs-skel" />
        </div>
      )}

      {empty && (
        <div className="pjs-empty">
          <div className="pjs-empty-art" aria-hidden="true"><Icon name="check" size={30} /></div>
          <h3>No work yet</h3>
          <p>Once {project.name} has work items, you'll see their status, priorities and progress here.</p>
          <button type="button" className="btn btn-primary" onClick={create}><Icon name="plus" size={16} /> Create your first work item</button>
        </div>
      )}

      {widgetProps && !empty && (
        <div className="pjs-grid" style={stale ? { opacity: 0.7 } : undefined}>
          <StatCards summary={widgetProps.summary} />
          <StatusDonut {...widgetProps} />
          <RecentActivity {...widgetProps} />
          <PriorityBars {...widgetProps} />
          <TypesOfWork {...widgetProps} />
          <TeamWorkload {...widgetProps} />
          <EpicProgress {...widgetProps} />
        </div>
      )}

      {summary && (
        <div className="pjs-feedback" aria-live="polite">
          {feedback ? <span className="pjs-thanks">Thanks for letting us know{feedback === 'up' ? '!' : ' — we’ll keep improving this page.'}</span> : (
            <>
              <span>Was this page useful?</span>
              <button type="button" className="pjs-thumb" onClick={() => setFeedback('up')} aria-label="Yes, this page was useful">👍</button>
              <button type="button" className="pjs-thumb" onClick={() => setFeedback('down')} aria-label="No, this page was not useful">👎</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
