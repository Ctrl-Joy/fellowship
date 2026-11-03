import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import { LogoMark } from '../components/Logo';
import { Avatar } from './fly/Avatar';
import { BoardScene, HuddleScene, IntegrationWindows, RoutinesStack, TalkPhone } from './fly/Scenes';
import { FEATURES, FOOTER, HERO, INTEGRATIONS, STATEMENT, TEMPLATES, USE_CASES } from './fly/content';
import '../styles/fly.css';

const RING = 18;
const clamp = (v: number) => Math.min(1, Math.max(0, v));
// Per-card depth for the fly-out: deeper cards rush past the viewer faster and grow larger.
const DEPTH = Array.from({ length: RING }, (_, i) => 0.45 + ((i * 7919) % 100) / 100 * 1.25);

/**
 * Fellowship landing. Pinned scroll scenes: a ring of teammates that turns and then scatters past the
 * viewer while a statement fills in; feature scenes that change as you scroll; an integrations hub; then
 * templates, use cases and a finale. One scroll handler (writes only on change) + one ring animation loop.
 */
export function LandingPage() {
  const root = useRef<HTMLDivElement>(null);
  const { hash } = useLocation();

  // Deep links like /welcome/scenes#projects: the router doesn't scroll to hashes, so do it here.
  useEffect(() => {
    if (!hash) return;
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (target) requestAnimationFrame(() => window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY, behavior: 'instant' as ScrollBehavior }));
  }, [hash]);

  useEffect(() => {
    const el = root.current!;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const $ = <T extends Element>(s: string) => el.querySelector<T>(s)!;
    const $$ = <T extends Element>(s: string) => [...el.querySelectorAll<T>(s)];
    const nav = $<HTMLElement>('.fy-nav');
    const hero = $<HTMLElement>('.fy-hero'), heroCopy = $<HTMLElement>('.fy-hero-copy');
    const cards = $$<HTMLElement>('.fy-orb'), words = $$<HTMLElement>('.fy-statement span'), statement = $<HTMLElement>('.fy-statement');
    const feat = $<HTMLElement>('.fy-features'), ftexts = $$<HTMLElement>('.fy-ftext'), fscenes = $$<HTMLElement>('.fy-fscene');
    const pills = $$<HTMLElement>('.fy-pill');
    const integ = $<HTMLElement>('.fy-integrations'), wins = $$<HTMLElement>('.fy-win');
    const phone = { step: -1 };
    const state = { heroP: 0, q: 0, scene: -1, talk: -1, wins: -1, navOn: false, words: -1 };

    const reveal = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); reveal.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px' });
    $$('.fy-reveal').forEach((n) => reveal.observe(n));

    const progressOf = (sec: HTMLElement, vh: number) => { const r = sec.getBoundingClientRect(); return clamp(-r.top / (r.height - vh)); };

    const onScroll = () => {
      const vh = window.innerHeight;
      // --- reads ---
      const heroP = progressOf(hero, vh), featP = progressOf(feat, vh), intP = progressOf(integ, vh);
      // --- writes (only when something actually changed) ---
      const navOn = window.scrollY > 20;
      if (navOn !== state.navOn) { state.navOn = navOn; nav.classList.toggle('solid', navOn); }

      state.heroP = heroP;
      state.q = reduce ? 0 : clamp((heroP - 0.28) / 0.62);
      heroCopy.style.opacity = String(1 - clamp((heroP - 0.18) / 0.14));
      heroCopy.style.transform = `translate3d(0, ${-clamp((heroP - 0.18) / 0.14) * 30}px, 0)`;
      // Statement words light up one by one as the cards scatter.
      const lit = reduce ? words.length : Math.floor(clamp((heroP - 0.35) / 0.5) * (words.length + 1));
      if (lit !== state.words) { state.words = lit; words.forEach((w, i) => w.classList.toggle('lit', i < lit)); }
      statement.style.opacity = String(reduce ? 1 : clamp((heroP - 0.3) / 0.08));

      // Features: four scenes across the pinned section; the first one steps through three conversation styles.
      const scene = Math.min(FEATURES.length - 1, Math.floor(featP * FEATURES.length));
      if (scene !== state.scene) {
        state.scene = scene;
        ftexts.forEach((t, i) => t.classList.toggle('on', i === scene));
        fscenes.forEach((s, i) => s.classList.toggle('on', i === scene));
      }
      const talk = scene === 0 ? Math.min(2, Math.floor((featP * FEATURES.length) * 3)) : state.talk;
      if (talk !== state.talk) {
        state.talk = talk;
        pills.forEach((p, i) => p.classList.toggle('on', i === talk));
        if (phone.step !== talk) { phone.step = talk; $$<HTMLElement>('.fy-phone-screen').forEach((s, i) => s.classList.toggle('on', i === talk)); }
      }
      // Integrations: windows slide in one by one.
      const shown = Math.floor(clamp((intP - 0.1) / 0.6) * (wins.length + 0.999));
      if (shown !== state.wins) { state.wins = shown; wins.forEach((w, i) => w.classList.toggle('in', i < shown)); }
      integ.style.setProperty('--ip', intP.toFixed(3));
    };

    // Ring: turns slowly on its own and with scroll; then each card flies outward by its own depth.
    let raf = 0, visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) raf = requestAnimationFrame(tick); });
    io.observe(hero);
    function tick(now: number) {
      raf = 0;
      if (!visible) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      const R = Math.min(vw * 0.4, vh * 0.38, 360);
      const rot = (reduce ? 0 : now * 0.00004) + state.heroP * 1.4;
      const q = state.q, qq = q * q;
      for (let i = 0; i < RING; i++) {
        const a = (i / RING) * Math.PI * 2 + rot - Math.PI / 2;
        const d = DEPTH[i];
        const rad = R * (1 + qq * 3.2 * d);
        const s = 1 + qq * 2.4 * d;
        const o = q < 0.8 ? 1 : 1 - (q - 0.8) / 0.2;
        const c = cards[i];
        c.style.transform = `translate3d(${Math.cos(a) * rad}px, ${Math.sin(a) * rad * 0.96}px, 0) scale(${s})`;
        c.style.opacity = String(o);
      }
      if (!reduce) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf); io.disconnect(); reveal.disconnect();
    };
  }, []);

  return (
    <div className="fy" ref={root}>
      <nav className="fy-nav">
        <Link to="/welcome" className="fy-brand"><LogoMark size={26} /> Fellowship</Link>
        <div className="fy-menu">
          {['Messaging', 'Workflows', 'Projects', 'Apps', 'Self-host'].map((m) => <a key={m} href={`#${m.toLowerCase()}`}>{m}</a>)}
        </div>
        <div className="fy-nav-right">
          <Link to="/login" className="fy-login">Log in</Link>
          <Link to="/signup" className="fy-btn">{HERO.cta}</Link>
        </div>
      </nav>

      <section className="fy-hero" aria-labelledby="fy-title">
        <div className="fy-hero-stage">
          <div className="fy-ring" aria-hidden="true">
            {Array.from({ length: RING }, (_, i) => <div key={i} className="fy-orb"><Avatar seed={i * 3 + 1} /></div>)}
          </div>
          <div className="fy-hero-copy">
            <h1 id="fy-title">{HERO.title[0]}<br />{HERO.title[1]}</h1>
            <Link to="/signup" className="fy-btn fy-btn-lg">{HERO.cta}</Link>
            <p className="fy-chaton">Works on {HERO.worksOn.map((w) => <span key={w}>{w}</span>)}</p>
          </div>
          <p className="fy-statement" aria-label={STATEMENT}>
            {STATEMENT.split(' ').map((w, i) => <span key={i} aria-hidden="true">{w} </span>)}
          </p>
          <div className="fy-works">Works with <span>Webhooks</span><span>Bots</span><span>Slash commands</span><span>Events</span></div>
        </div>
      </section>

      <section className="fy-features" id="messaging">
        {/* Scenes are pinned, so deep links land where each scene is shown (its share of the scroll). */}
        <span id="workflows" className="fy-anchor" style={{ top: '27%' }} />
        <span id="projects" className="fy-anchor" style={{ top: '48%' }} />
        <div className="fy-features-stage">
          <div className="fy-ftexts">
            {FEATURES.map((f, i) => (
              <div key={f.key} className={`fy-ftext${i === 0 ? ' on' : ''}`}>
                <h2>{f.title}</h2>
                {f.pills && <div className="fy-pills">{f.pills.map((p, k) => <span key={p} className={`fy-pill${k === 0 ? ' on' : ''}`}>{p}</span>)}</div>}
                <p>{f.body}</p>
                <Link to="/signup" className="fy-more">{f.cta} <span aria-hidden="true">→</span></Link>
              </div>
            ))}
          </div>
          <div className="fy-fscenes" aria-hidden="true">
            <div className="fy-fscene on"><TalkPhone step={0} /></div>
            <div className="fy-fscene"><RoutinesStack /></div>
            <div className="fy-fscene"><BoardScene /></div>
            <div className="fy-fscene"><HuddleScene /></div>
          </div>
        </div>
      </section>

      <section className="fy-integrations" id="apps">
        <div className="fy-int-stage">
          <div className="fy-int-head">
            <h2>{INTEGRATIONS.title}</h2>
            <p>{INTEGRATIONS.body}</p>
            <Link to="/signup" className="fy-more">{INTEGRATIONS.cta} <span aria-hidden="true">→</span></Link>
          </div>
          <div className="fy-hub" aria-hidden="true">
            <span className="fy-orbit o1" /><span className="fy-orbit o2" /><span className="fy-orbit o3" />
            <div className="fy-hub-core"><LogoMark size={44} framed={false} /></div>
            <IntegrationWindows />
          </div>
        </div>
      </section>

      <section className="fy-templates">
        <h2 className="fy-reveal">Start with a template</h2>
        <p className="fy-sub fy-reveal">Get going in minutes with ready-made workflows, canvases and apps.</p>
        <div className="fy-tgrid">
          {TEMPLATES.map((t, i) => (
            <article key={t.title} className="fy-tcard fy-reveal" style={{ transitionDelay: `${(i % 4) * 0.06}s` }}>
              <div className="fy-tcard-top"><Avatar seed={i * 5 + 2} className="fy-tcard-av" /><span className="fy-plus">+</span></div>
              <h3>{t.title}</h3>
              <p>{t.body}</p>
              <span className="fy-kind">{t.kind}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="fy-uses" id="self-host">
        <h2 className="fy-reveal">How teams use Fellowship</h2>
        <div className="fy-lead fy-reveal">
          <Avatar seed={40} className="fy-lead-av" />
          <div>
            <p className="fy-lead-quote">{USE_CASES.lead.text}</p>
            <p className="fy-lead-team">{USE_CASES.lead.team} <span>· example workflow</span></p>
          </div>
        </div>
        <div className="fy-marquee" aria-label="More examples">
          <div className="fy-marquee-track">
            {[...USE_CASES.cards, ...USE_CASES.cards].map((c, i) => (
              <div key={i} className="fy-ucard" aria-hidden={i >= USE_CASES.cards.length}>
                <b>{c.team}</b><p>{c.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="fy-finale">
        <svg className="fy-landscape" viewBox="0 0 1440 720" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
          <defs>
            <linearGradient id="fy-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3B4C8C" /><stop offset="0.45" stopColor="#C77B8B" /><stop offset="0.75" stopColor="#F2B27A" /><stop offset="1" stopColor="#F7D6A0" />
            </linearGradient>
            <linearGradient id="fy-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stopColor="#101010" stopOpacity="0" /><stop offset="1" stopColor="#101010" /></linearGradient>
          </defs>
          <rect width="1440" height="720" fill="url(#fy-sky)" />
          <path d="M0 470 L120 420 L260 455 L400 380 L560 440 L700 360 L860 430 L1010 370 L1160 430 L1300 390 L1440 420 L1440 720 L0 720 Z" fill="#7A6A8E" opacity="0.75" />
          <path d="M0 540 L160 470 L320 520 L470 450 L640 520 L800 460 L980 525 L1140 470 L1300 520 L1440 480 L1440 720 L0 720 Z" fill="#4C4566" />
          <path d="M0 610 L200 560 L380 600 L560 545 L760 605 L940 560 L1120 610 L1300 570 L1440 600 L1440 720 L0 720 Z" fill="#2A2738" />
          <rect width="1440" height="720" fill="url(#fy-fade)" />
        </svg>
        <div className="fy-finale-copy fy-reveal">
          <h2>Gather your fellowship</h2>
          <Link to="/signup" className="fy-btn fy-btn-dark">Get started <span aria-hidden="true">→</span></Link>
        </div>
        <footer className="fy-footer">
          <div className="fy-foot-brand"><LogoMark size={34} /><p>Self-hosted team chat, calls, docs, workflows and projects.</p></div>
          {FOOTER.map((c) => (
            <div key={c.title} className="fy-foot-col"><h4>{c.title}</h4>{c.links.map((l) => <a key={l} href="#">{l}</a>)}</div>
          ))}
        </footer>
      </section>
    </div>
  );
}
