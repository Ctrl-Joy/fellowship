import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import '../styles/fellowship.css';

/** Orbit tracks in a 1000×560 design space shared with the SVG, so tracks and tiles stay aligned at any size. */
const TRACKS = [
  { cx: 500, cy: 290, rx: 520, ry: 150, tilt: -12, speed: 0.1 },
  { cx: 520, cy: 280, rx: 420, ry: 200, tilt: 22, speed: -0.075 },
  { cx: 480, cy: 300, rx: 300, ry: 250, tilt: -36, speed: 0.065 },
];

/** Glass tiles orbiting the word, one per Fellowship feature. */
const TILES: { icon: string; color: string; track: number; phase: number; size: number }[] = [
  { icon: 'messages', color: '#ffffff', track: 0, phase: 0.2, size: 74 },
  { icon: 'headphones', color: '#3B5BDB', track: 0, phase: 2.3, size: 64 },
  { icon: 'canvas', color: '#111111', track: 0, phase: 4.4, size: 58 },
  { icon: 'workflow', color: '#C6F432', track: 1, phase: 0.9, size: 70 },
  { icon: 'at', color: '#7048E8', track: 1, phase: 3.3, size: 50 },
  { icon: 'hash', color: '#FA4C0D', track: 1, phase: 5.2, size: 60 },
  { icon: 'bell', color: '#ffffff', track: 2, phase: 1.6, size: 54 },
  { icon: 'video', color: '#1C7ED6', track: 2, phase: 4.6, size: 46 },
];

const MARKERS = [{ track: 0, angle: 3.3 }, { track: 0, angle: 0.15 }, { track: 1, angle: 2.4 }, { track: 1, angle: 5.9 }, { track: 2, angle: 1.0 }];

function pointOn(t: (typeof TRACKS)[number], angle: number) {
  const x = t.rx * Math.cos(angle);
  const y = t.ry * Math.sin(angle);
  const r = (t.tilt * Math.PI) / 180;
  return { x: t.cx + x * Math.cos(r) - y * Math.sin(r), y: t.cy + x * Math.sin(r) + y * Math.cos(r), depth: Math.sin(angle) };
}

const WORD = 'Fellowship';

const TIERS = [
  { label: 'Starting out', value: '10+', unit: 'members', body: 'A few channels, a place for quick questions, and a huddle whenever it is easier to talk.',
    fit: ['A new group or side project', 'One workspace'], gets: ['Channels and direct messages', 'Threads, reactions and search', 'Huddles for up to 8 people'] },
  { label: 'Growing', value: '100+', unit: 'members', body: 'Shared notes, routines that run themselves and plans everyone can follow as the community fills up.',
    fit: ['Clubs, classes and teams', 'Several organisers'], gets: ['Canvases for shared notes', 'Workflows for sign-ups and reminders', 'Project boards for plans', 'Guests for visitors'] },
  { label: 'Network', value: '1000+', unit: 'members', body: 'Several workspaces, connected tools and verified sign-ins for a large community you run yourself.',
    fit: ['Large or public communities', 'Several workspaces'], gets: ['Apps, bots and webhooks', 'Slash commands and events', 'Email verification for every member', 'Self-hosted on your own server'] },
];

const FIT = [
  { icon: 'users', title: 'You bring people together', body: 'A club, a class, a team, a project or a whole neighbourhood.' },
  { icon: 'hash', title: 'You need more than a group chat', body: 'A channel per topic, threads for side conversations.' },
  { icon: 'headphones', title: 'You like to talk face to face', body: 'Huddles start in one click from any channel.' },
  { icon: 'workflow', title: 'You repeat the same jobs', body: 'Welcomes, sign-ups and reminders can run themselves.' },
  { icon: 'grid', title: 'You plan in the open', body: 'Boards and work items everyone in the community can see.' },
  { icon: 'lock', title: 'You want to own your data', body: 'Host Fellowship yourself and keep every message.' },
];

const RESOURCES = ['Start a workspace', 'Community templates', 'Apps & bots', 'Self-hosting guide'];

const FAQ = [
  { q: 'What does Fellowship include?', a: 'Channels, direct messages, threads, reactions, search, huddles with voice, video and screen share, canvases, workflows, project boards, and apps with bots, webhooks and slash commands.' },
  { q: 'Is Fellowship free?', a: 'Yes. Fellowship runs on your own server, and every feature is available to every workspace.' },
  { q: 'How do people join my community?', a: 'Invite them by email or share an invite link. New members verify their email address before they can sign in.' },
  { q: 'Can I keep some channels private?', a: 'Yes. Private channels are visible only to the members you add, and guests can be limited to the channels you choose.' },
  { q: 'Can I automate welcomes and reminders?', a: 'Workflows can greet new members, collect form responses, post on a schedule and route requests for approval.' },
  { q: 'Does it work on my phone?', a: 'Fellowship runs in any modern browser on desktop and phone, and the layout adapts to small screens.' },
  { q: 'Can I connect the tools we already use?', a: 'Yes. Create a bot, post updates through incoming webhooks, add slash commands, or subscribe to signed events.' },
  { q: 'Where is my data stored?', a: 'In a SQLite database on the server you run Fellowship on. Nothing is sent anywhere else.' },
];

const FOOTER = [
  { title: 'Product', links: ['Channels', 'Huddles', 'Canvases', 'Workflows', 'Projects'] },
  { title: 'Communities', links: ['Open communities', 'Private teams', 'Classes & clubs', 'Open source'] },
  { title: 'Resources', links: ['Templates', 'Apps & bots', 'Self-hosting', 'Docs'] },
  { title: 'Fellowship', links: ['About', 'Security', 'Contact'] },
];

function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.9} viewBox="4 3 56 50" fill="none" stroke="#FA4C0D" strokeWidth="6" aria-hidden="true">
      <circle cx="32" cy="20" r="11" />
      <circle cx="23" cy="36" r="11" />
      <circle cx="41" cy="36" r="11" />
    </svg>
  );
}

function Chevron() {
  return <svg viewBox="0 0 8 5" width="8" height="5" aria-hidden="true"><path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** Fellowship's landing page: an orbiting wordmark hero followed by plans, fit, resources, FAQ and footer. */
export function FellowshipLanding() {
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const tiles = useRef<(HTMLDivElement | null)[]>([]);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  // Orbiting tiles: runs only while the hero is on screen.
  useEffect(() => {
    document.title = 'Fellowship — Where your community gathers';
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const el = stage.current!;
    let raf = 0;
    let visible = true;
    const start = performance.now();
    const frame = (now: number) => {
      const { width, height } = el.getBoundingClientRect();
      const sx = width / 1000, sy = height / 560;
      const scale = Math.min(1.4, Math.max(0.62, width / 820));
      const secs = reduce ? 0 : (now - start) / 1000;
      TILES.forEach((c, i) => {
        const node = tiles.current[i];
        if (!node) return;
        const t = TRACKS[c.track];
        const p = pointOn(t, c.phase + (secs * t.speed * Math.PI * 2) / 3.6);
        const front = p.depth > 0;
        const s = scale * (0.8 + (0.24 * (p.depth + 1)) / 2);
        const rot = Math.sin(c.phase + secs * 0.55) * 12 + (i % 2 ? -10 : 10);
        node.style.transform = `translate(${p.x * sx}px, ${p.y * sy}px) translate(-50%, -50%) rotate(${rot}deg) scale(${s})`;
        node.style.zIndex = front ? '4' : '1';
      });
      if (!reduce && visible) raf = requestAnimationFrame(frame);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible) raf = requestAnimationFrame(frame);
    });
    io.observe(el);
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); io.disconnect(); };
  }, []);

  // Header collapse, hero lift, and reveal-on-scroll.
  useEffect(() => {
    const el = root.current!;
    const header = el.querySelector<HTMLElement>('.fl-header')!;
    const words = el.querySelector<HTMLElement>('.fl-words')!;
    let compact = false;
    let lastLift = -1;
    const onScroll = () => {
      const y = window.scrollY;
      const c = y > 60;
      if (c !== compact) { compact = c; header.classList.toggle('compact', c); }
      const lift = Math.min(1, y / (window.innerHeight * 0.9));
      if (Math.abs(lift - lastLift) > 0.002) {
        lastLift = lift;
        words.style.transform = `translate3d(0, ${-lift * 90}px, 0) scale(${1 - lift * 0.06})`;
        words.style.opacity = String(1 - lift * 0.55);
      }
    };
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -10% 0px' });
    el.querySelectorAll('.fl-reveal').forEach((n) => io.observe(n));
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => { window.removeEventListener('scroll', onScroll); io.disconnect(); };
  }, []);

  return (
    <div className="fl" ref={root}>
      <header className="fl-header">
        <Link to="/" className="fl-logo" aria-label="Fellowship home">
          <Mark />
          <span className="fl-wordmark">FELLOWSHIP</span>
        </Link>
        <nav className="fl-nav" aria-label="Main">
          <a href="#plans">Product <Chevron /></a>
          <a href="#fit">Communities <Chevron /></a>
          <a href="#resources">Resources <Chevron /></a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="fl-actions">
          <Link to="/login" className="fl-login">Login</Link>
          <Link to="/signup" className="fl-plain">Create account</Link>
          <Link to="/signup" className="fl-pill fl-pill-sm fl-header-cta">Start your community</Link>
        </div>
      </header>

      <section className="fl-hero" aria-labelledby="fl-title">
        <div className="fl-stage" ref={stage}>
          <svg className="fl-orbits" viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true">
            {TRACKS.map((t, i) => (
              <ellipse key={i} cx={t.cx} cy={t.cy} rx={t.rx} ry={t.ry} transform={`rotate(${t.tilt} ${t.cx} ${t.cy})`} vectorEffect="non-scaling-stroke" />
            ))}
            {MARKERS.map((m, i) => { const p = pointOn(TRACKS[m.track], m.angle); return <circle key={i} cx={p.x} cy={p.y} r="3" />; })}
          </svg>
          <div className="fl-words">
            <span className="fl-ghost" aria-hidden="true">{WORD}</span>
            <h1 id="fl-title" className="fl-word">{WORD}</h1>
            <span className="fl-ghost" aria-hidden="true">{WORD}</span>
          </div>
          {TILES.map((c, i) => (
            <div key={c.icon} className="fl-tile" ref={(n) => { tiles.current[i] = n; }} style={{ width: c.size, height: c.size }} aria-hidden="true">
              <span className="fl-tile-icon" style={{ background: c.color, color: c.color === '#ffffff' || c.color === '#C6F432' ? '#111' : '#fff' }}>
                <Icon name={c.icon} size={Math.round(c.size * 0.3)} />
              </span>
            </div>
          ))}
        </div>
        <div className="fl-hero-copy fl-reveal">
          <p>Fellowship gives every community a home: channels for every topic, threads for every question, huddles when typing isn't enough, and workflows that welcome every new member the moment they arrive.</p>
          <Link to="/signup" className="fl-pill">Start your community</Link>
        </div>
      </section>

      <section className="fl-section" id="plans">
        <h2 className="fl-reveal">Grows with your community</h2>
        <p className="fl-lead fl-reveal">Every feature is free in every workspace. Here's where to start, based on where your community is today.</p>
        <div className="fl-tiers">
          {TIERS.map((t, i) => (
            <article key={t.label} className="fl-tier fl-reveal" style={{ transitionDelay: `${i * 90}ms` }}>
              <div className="fl-badge">
                <span className="fl-badge-label">{t.label}</span>
                <span className="fl-badge-value">{t.value}</span>
                <span className="fl-badge-unit">{t.unit}</span>
              </div>
              <p className="fl-tier-body">{t.body}</p>
              <h3>Best for</h3>
              <ul className="fl-boxes">{t.fit.map((f) => <li key={f}>{f}</li>)}</ul>
              <h3>Start with</h3>
              <ul className="fl-checks">{t.gets.map((g) => <li key={g}>{g}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>

      <section className="fl-section" id="fit">
        <h2 className="fl-reveal">Is Fellowship right for you?</h2>
        <p className="fl-lead fl-reveal">It's a good fit if your community does any of the following:</p>
        <div className="fl-grid fl-reveal">
          {FIT.map((f) => (
            <div key={f.title} className="fl-cell">
              <Icon name={f.icon} size={18} />
              <strong>{f.title}</strong>
              <span>{f.body}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="fl-section fl-resources" id="resources">
        <h2 className="fl-reveal">Resources for organisers</h2>
        <p className="fl-lead fl-reveal">Get your community going with Fellowship.</p>
        <div className="fl-chips fl-reveal">
          {RESOURCES.map((r) => <Link key={r} to="/signup" className="fl-chip">{r}</Link>)}
        </div>
      </section>

      <section className="fl-section" id="faq">
        <h2 className="fl-reveal">Frequently asked questions</h2>
        <div className="fl-faq fl-reveal">
          {FAQ.map((f, i) => {
            const open = openFaq === i;
            return (
              <div key={f.q} className={`fl-q${open ? ' open' : ''}`}>
                <button aria-expanded={open} onClick={() => setOpenFaq(open ? null : i)}>
                  <span>{f.q}</span>
                  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
                </button>
                <div className="fl-a"><p>{f.a}</p></div>
              </div>
            );
          })}
        </div>
      </section>

      <footer className="fl-footer">
        <div className="fl-footer-top">
          <div className="fl-footer-brand">
            <Mark size={34} />
            <span className="fl-wordmark">FELLOWSHIP</span>
          </div>
          {FOOTER.map((col) => (
            <div key={col.title} className="fl-footer-col">
              <h4>{col.title}</h4>
              {col.links.map((l) => <Link key={l} to="/signup">{l}</Link>)}
            </div>
          ))}
        </div>
        <div className="fl-footer-bottom">
          <span>© {new Date().getFullYear()} Fellowship</span>
          <Link to="/login">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
