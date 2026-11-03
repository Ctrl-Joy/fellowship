import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { LogoMark } from '../components/Logo';
import { CATEGORIES, START_COLOR, STATS, TAGLINE } from './landing/content';
import { Constellation } from './landing/Constellation';
import { Scene } from './landing/Scenes';
import { HubBurst } from './landing/HubBurst';
import '../styles/editions.css';

/** Highlight colour for the one emphasised spoke in each interlude. */
const ACCENTS = ['#7CFFC4', '#FFD27A', '#9DB4FF', '#FF9DBB'];

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/**
 * Fellowship landing: a giant wordmark hero with a live network panel, then one section per product
 * area. The page colour blends from area to area as each section scrolls in.
 */
export function LandingPage() {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = root.current!;
    const sections = [...el.querySelectorAll<HTMLElement>('[data-ed-section]')];
    const interludes = [...el.querySelectorAll<HTMLElement>('.ed-interlude')];
    const colors = CATEGORIES.map((c) => hex(c.color));
    // Cards and notes fade up the first time they scroll into view.
    const reveal = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); reveal.unobserve(e.target); }
    }, { rootMargin: '0px 0px -12% 0px' });
    el.querySelectorAll('.ed-reveal').forEach((n) => reveal.observe(n));
    const update = () => {
      const vh = window.innerHeight;
      // Each section's progress runs 0→1 as its top travels from the bottom of the viewport to the middle,
      // and the page colour is mixed through every section in order (like a chain of colour-mix steps).
      let c = hex(START_COLOR);
      let current = -1;
      sections.forEach((s, i) => {
        const top = s.getBoundingClientRect().top;
        const p = Math.min(1, Math.max(0, (vh - top) / (vh * 0.5)));
        c = mix(c, colors[i], p);
        if (top < vh * 0.5) current = i;
      });
      el.style.setProperty('--ed-page', `rgb(${c.join(',')})`);
      // Interlude progress: 0 when it enters from below, 1 once its sticky stage has been fully scrolled.
      for (const it of interludes) {
        const r = it.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, (vh - r.top) / (r.height)));
        it.dataset.progress = p.toFixed(3);
        // The heading is only on screen once the stage pins (~66%), so the letter fill runs from there.
        it.style.setProperty('--p', Math.min(1, Math.max(0, (p - 0.66) / 0.29)).toFixed(3));
      }
      setActive(current);
      setScrolled(window.scrollY > 8);
    };
    // Run straight from the scroll event: it's a handful of rect reads, and waiting a frame lags the fill.
    const onScroll = () => update();
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); reveal.disconnect(); };
  }, []);

  const jump = (id: string) => document.getElementById(`ed-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="ed" ref={root}>
      <header className={`ed-nav${scrolled ? ' scrolled' : ''}`}>
        <Link to="/welcome" className="ed-brand">
          <LogoMark size={26} />
          <span><b>Fellowship</b><small>What's new</small></span>
        </Link>
        <nav className="ed-nav-links">
          <button onClick={() => jump(CATEGORIES[0].id)}>Features</button>
          <Link to="/welcome/orbit">Tour</Link>
        </nav>
        <div className="ed-nav-cta">
          <Link to="/login" className="ed-signin">Sign in</Link>
          <Link to="/signup" className="ed-pill">Get started</Link>
        </div>
      </header>

      <section className="ed-hero" aria-labelledby="ed-title">
        <div className="ed-word-col">
          <h1 id="ed-title" className="ed-word">Fellowship</h1>
          <p className="ed-tagline">{TAGLINE}</p>
        </div>
        <aside className="ed-side">
          <ol className="ed-index">
            {CATEGORIES.map((c, i) => (
              <li key={c.id}><button onClick={() => jump(c.id)}><span>{c.name}</span><span>{String(i + 1).padStart(2, '0')}</span></button></li>
            ))}
          </ol>
          {STATS.map((s) => (
            <div key={s.label} className="ed-stat"><b>{s.value}</b><p>{s.label}</p></div>
          ))}
        </aside>
        <div className="ed-panel"><Constellation /></div>
      </section>

      <div className="ed-body">
        <nav className="ed-rail" aria-label="Sections">
          {CATEGORIES.map((c, i) => (
            <button key={c.id} className={i === active ? 'on' : ''} onClick={() => jump(c.id)}>
              <span className="ed-rail-dot" />{c.name}
            </button>
          ))}
        </nav>
        <main className="ed-sections">
          {CATEGORIES.map((c, i) => (
            <section key={c.id} id={`ed-${c.id}`} data-ed-section className="ed-section" aria-labelledby={`ed-h-${c.id}`}>
              {/* Interlude: a close-up of this area's hub; the heading fills letter by letter as you scroll. */}
              <div className="ed-interlude" data-progress="0">
                <div className="ed-interlude-stage">
                  <HubBurst seed={i + 1} accent={ACCENTS[i % ACCENTS.length]} />
                  <h2 id={`ed-h-${c.id}`} className="ed-h2" aria-label={c.name}>
                    <span className="ed-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                    <span className="ed-fill" aria-hidden="true" style={{ '--n': c.name.length } as CSSProperties}>
                      {[...c.name].map((ch, k) => <span key={k} style={{ '--i': k } as CSSProperties}>{ch}</span>)}
                    </span>
                  </h2>
                </div>
              </div>
              <div className={`ed-features${c.features.length > 1 ? ' two' : ''}`}>
                {c.features.map((f) => (
                  <article key={f.title} className="ed-feature ed-reveal">
                    <div className="ed-feature-text">
                      <h3><span className="ed-bullet" />{f.title}</h3>
                      <p>{f.body}</p>
                      <Link to="/signup" className="ed-mono-pill">{f.cta}</Link>
                    </div>
                    <Scene kind={f.scene} />
                  </article>
                ))}
              </div>
              <div className="ed-notes ed-reveal">
                <p className="ed-notes-label">Also new</p>
                <ul>{c.notes.map((n) => <li key={n}><span>+</span>{n}</li>)}</ul>
              </div>
            </section>
          ))}
        </main>
      </div>

      <footer className="ed-end">
        <p className="ed-end-word">Fellowship</p>
        <div className="ed-end-row">
          <p>Bring the whole team. Self-hosted, no per-seat fees, everything in one place.</p>
          <Link to="/signup" className="ed-pill ed-pill-lg">Get started free</Link>
        </div>
      </footer>
    </div>
  );
}
