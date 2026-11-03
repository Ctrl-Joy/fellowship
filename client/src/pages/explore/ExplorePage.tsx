import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { Icon } from '../../components/Icon';
import { SiteFooter, SiteHeader } from '../FellowshipLanding';
import { EXPLORE } from './content';
import '../../styles/fellowship.css';

/** One page per footer link: title, lead, feature grid or setup steps, and links to the rest of its column. */
export function ExplorePage() {
  const { slug = '' } = useParams();
  const page = EXPLORE[slug];

  useEffect(() => {
    document.title = page ? `${page.label} — Fellowship` : 'Fellowship';
    window.scrollTo(0, 0);
  }, [page]);

  return (
    <div className="fl">
      <SiteHeader />
      {page ? (
        <main className="fx-main">
          <div className="fx-crumb">
            <Link to="/welcome">Fellowship</Link><span aria-hidden="true">/</span>
            <span>{page.group}</span><span aria-hidden="true">/</span>
            <span>{page.label}</span>
          </div>
          <h1 className="fx-title">{page.title}</h1>
          <p className="fx-lead">{page.lead}</p>
          {page.cta && <Link to={page.cta.to} className="fl-pill fx-cta">{page.cta.label}</Link>}

          {page.points.length > 0 && (
            <div className="fx-points">
              {page.points.map((p) => (
                <div key={p.title} className="fl-cell">
                  <Icon name="check" size={18} />
                  <strong>{p.title}</strong>
                  <span>{p.body}</span>
                </div>
              ))}
            </div>
          )}

          {page.steps && (
            <ol className="fx-steps">
              {page.steps.map((s, i) => (
                <li key={s.title} className="fx-step">
                  <span className="fx-step-n">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <strong>{s.title}</strong>
                    <p>{s.body}</p>
                    {s.code && <pre><code>{s.code}</code></pre>}
                  </div>
                </li>
              ))}
            </ol>
          )}

          <section className="fx-more">
            <h2>More in {page.group}</h2>
            <div className="fl-chips" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
              {Object.entries(EXPLORE)
                .filter(([s, p]) => p.group === page.group && s !== slug)
                .map(([s, p]) => <Link key={s} to={`/explore/${s}`} className="fl-chip">{p.label}</Link>)}
            </div>
          </section>
        </main>
      ) : (
        <main className="fx-main fx-missing">
          <h1 className="fx-title">Page not found</h1>
          <p className="fx-lead">That page doesn't exist. Head back to the start.</p>
          <Link to="/welcome" className="fl-pill fx-cta">Back to Fellowship</Link>
        </main>
      )}
      <SiteFooter />
    </div>
  );
}
