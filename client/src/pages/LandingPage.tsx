import { useEffect, useRef, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { LogoMark } from '../components/Logo';
import { CATEGORIES, START_COLOR, STATS, TAGLINE } from './landing/content';
import { NetworkMap, type DiveState } from './landing/NetworkMap';
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
  const nav = useRef<HTMLElement>(null);
  const rail = useRef<HTMLElement>(null);
  const hero = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const dive = useRef<DiveState>({ p: 0, page: hex(START_COLOR) as [number, number, number], view: { t: 0, r: 0, b: 0, l: 0 } });

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
    const railButtons = [...rail.current!.querySelectorAll('button')];
    const fadeAway = [...el.querySelectorAll<HTMLElement>('.ed-dive-away')];
    let lastActive = -2, lastScrolled: boolean | null = null, lastBg = '', lastNavO = '';
    // Reads first, then writes, and no inherited custom properties on big subtrees: each scroll frame
    // touches only the few elements that actually change, so style recalc stays tiny.
    const update = () => {
      const vh = window.innerHeight;
      // Each section's progress runs 0→1 as its top travels from the bottom of the viewport to the middle,
      // and the page colour is mixed through every section in order (like a chain of colour-mix steps).
      let c = hex(START_COLOR);
      let current = -1;
      sections.forEach((s, i) => {
        const top = s.getBoundingClientRect().top;
        // Measured on the reference: each colour step runs over the first 360px after the section enters.
        const p = Math.min(1, Math.max(0, (vh - top) / 360));
        c = mix(c, colors[i], p);
        if (top < vh * 0.5) current = i;
      });
      const bg = `rgb(${c.join(',')})`;
      // Hero dive (desktop): the map's clip opens from the panel's box to the whole screen while the
      // wordmark and index slide away; the map itself zooms into the first hub (see NetworkMap).
      const desktop = window.matchMedia('(min-width: 961px)').matches;
      const st = stage.current!, pn = panel.current!, ly = layer.current!;
      let p = 0;
      if (desktop) {
        const hr = hero.current!.getBoundingClientRect();
        p = Math.min(1, Math.max(0, -hr.top / (hr.height - vh)));
        const sr = st.getBoundingClientRect(), pr = pn.getBoundingClientRect();
        const k = 1 - p * p * (3 - 2 * p);
        const v = { t: (pr.top - sr.top) * k, r: (sr.right - pr.right) * k, b: (sr.bottom - pr.bottom) * k, l: (pr.left - sr.left) * k };
        ly.style.cssText = `clip-path: inset(${v.t}px ${v.r}px ${v.b}px ${v.l}px)`;
        dive.current.view = v;
        for (const f of fadeAway) { f.style.opacity = String(Math.max(0, 1 - (1 - k) * 1.8)); f.style.transform = `translate3d(${-(1 - k) * 90}px, 0, 0)`; }
      } else {
        ly.style.cssText = `top: ${pn.offsetTop}px; left: ${pn.offsetLeft}px; width: ${pn.offsetWidth}px; height: ${pn.offsetHeight}px; clip-path: none`;
        dive.current.view = { t: 0, r: 0, b: 0, l: 0 };
        for (const f of fadeAway) { f.style.opacity = ''; f.style.transform = ''; }
      }
      if (bg !== lastBg) { lastBg = bg; el.style.backgroundColor = bg; nav.current!.style.setProperty('--ed-page', bg); }
      dive.current.p = p;
      dive.current.page = c as [number, number, number];
      // Interlude progress: 0 when it enters from below, 1 once its sticky stage has been fully scrolled.
      for (const it of interludes) {
        const r = it.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, (vh - r.top) / (r.height)));
        const ps = p.toFixed(3);
        if (it.dataset.progress === ps) continue; // off-screen interludes stay untouched
        it.dataset.progress = ps;
        // The heading is only on screen once the stage pins (~66%), so the letter fill runs from there.
        it.style.setProperty('--p', Math.min(1, Math.max(0, (p - 0.66) / 0.29)).toFixed(3));
      }
      if (current !== lastActive) {
        lastActive = current;
        railButtons.forEach((b, i) => b.classList.toggle('on', i === current));
        rail.current!.classList.toggle('shown', current >= 0);
      }
      // Nav underlay fades in over the first 32px of scroll.
      const navO = Math.min(1, window.scrollY / 32).toFixed(2);
      if (navO !== lastNavO) { lastNavO = navO; nav.current!.style.setProperty('--nav-o', navO); }
      const scrolled = window.scrollY > 8;
      if (scrolled !== lastScrolled) { lastScrolled = scrolled; nav.current!.classList.toggle('scrolled', scrolled); }
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
      <header className="ed-nav" ref={nav}>
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

      <section className="ed-hero" ref={hero} aria-labelledby="ed-title">
        <div className="ed-hero-stage" ref={stage}>
        <div className="ed-word-col ed-dive-away">
          <h1 id="ed-title" className="ed-word">Fellowship</h1>
          <p className="ed-tagline">{TAGLINE}</p>
        </div>
        <aside className="ed-side ed-dive-away">
          <ol className="ed-index">
            {CATEGORIES.map((c, i) => (
              <li key={c.id}><button onClick={() => jump(c.id)}><span>{c.name}</span><span>{String(i + 1).padStart(2, '0')}</span></button></li>
            ))}
          </ol>
          {STATS.map((s) => (
            <div key={s.label} className="ed-stat"><b>{s.value}</b><p>{s.label}</p></div>
          ))}
        </aside>
        <div className="ed-panel" ref={panel} />
        <div className="ed-map-layer" ref={layer}><NetworkMap dive={dive} /></div>
        </div>
      </section>

      <div className="ed-body">
        <nav className="ed-rail" ref={rail} aria-label="Sections">
          {CATEGORIES.map((c) => (
            <button key={c.id} onClick={() => jump(c.id)}>
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
