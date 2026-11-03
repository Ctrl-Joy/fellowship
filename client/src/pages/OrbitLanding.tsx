import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { LogoMark } from '../components/Logo';
import { Icon } from '../components/Icon';
import '../styles/landing.css';

/**
 * Orbit tracks in a 1000×560 design space (the SVG uses the same space, so the drawn dotted
 * ellipses and the card positions stay aligned at any size). `tilt` rotates the ellipse.
 */
const TRACKS = [
  { cx: 500, cy: 300, rx: 470, ry: 120, tilt: -14, speed: 0.11 },
  { cx: 500, cy: 280, rx: 400, ry: 170, tilt: 18, speed: -0.08 },
  { cx: 520, cy: 290, rx: 300, ry: 230, tilt: -32, speed: 0.07 },
];

/** Fellowship features shown on the glass cards. */
const CARDS: { icon: string; color: string; track: number; phase: number; size: number }[] = [
  { icon: 'messages', color: '#2A8C74', track: 0, phase: 0.1, size: 70 },
  { icon: 'headphones', color: '#3B5BDB', track: 0, phase: 2.2, size: 62 },
  { icon: 'canvas', color: '#111111', track: 0, phase: 4.3, size: 56 },
  { icon: 'workflow', color: '#C6F432', track: 1, phase: 0.9, size: 68 },
  { icon: 'at', color: '#7048E8', track: 1, phase: 3.4, size: 46 },
  { icon: 'hash', color: '#F2A541', track: 1, phase: 5.2, size: 58 },
  { icon: 'bell', color: '#E8590C', track: 2, phase: 1.6, size: 52 },
  { icon: 'smile', color: '#495057', track: 2, phase: 4.6, size: 40 },
];

/** Small fixed markers sitting on the tracks, like rivets on a rail. */
const MARKERS = [
  { track: 0, angle: 3.3 }, { track: 0, angle: 0.15 }, { track: 1, angle: 2.4 }, { track: 1, angle: 5.9 }, { track: 2, angle: 1.0 },
];

function pointOn(t: typeof TRACKS[number], angle: number) {
  const x = t.rx * Math.cos(angle);
  const y = t.ry * Math.sin(angle);
  const r = (t.tilt * Math.PI) / 180;
  return { x: t.cx + x * Math.cos(r) - y * Math.sin(r), y: t.cy + x * Math.sin(r) + y * Math.cos(r), depth: Math.sin(angle) };
}

const WORD = 'Fellowship';

export function OrbitLanding() {
  const stage = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      const el = stage.current;
      if (el) {
        const { width, height } = el.getBoundingClientRect();
        const sx = width / 1000, sy = height / 560;
        const scale = Math.min(1.5, Math.max(0.7, width / 760));
        const secs = reduce ? 0 : (now - start) / 1000;
        CARDS.forEach((c, i) => {
          const node = cards.current[i];
          if (!node) return;
          const t = TRACKS[c.track];
          const p = pointOn(t, c.phase + secs * t.speed * Math.PI * 2 / 3.6);
          // Front half of the orbit passes over the word, back half behind it.
          const front = p.depth > 0;
          const s = scale * (0.82 + 0.22 * (p.depth + 1) / 2);
          const rot = Math.sin(c.phase + secs * 0.6) * 12 + (i % 2 ? -10 : 10);
          node.style.transform = `translate(${p.x * sx}px, ${p.y * sy}px) translate(-50%, -50%) rotate(${rot}deg) scale(${s})`;
          node.style.zIndex = front ? '4' : '1';
          node.style.opacity = String(front ? 1 : 0.78);
        });
      }
      if (!reduce) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onResize = () => { if (reduce) requestAnimationFrame(frame); };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, []);

  return (
    <div className="lp">
      <header className="lp-nav">
        <Link to="/" className="lp-brand"><LogoMark size={28} /> Fellowship</Link>
        <nav>
          <Link to="/login" className="lp-link">Sign in</Link>
          <Link to="/signup" className="lp-cta">Get started</Link>
        </nav>
      </header>

      <section className="hero" aria-label="Fellowship">
        <div className="hero-stage" ref={stage}>
          <svg className="hero-orbits" viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true">
            {TRACKS.map((t, i) => (
              <ellipse key={i} cx={t.cx} cy={t.cy} rx={t.rx} ry={t.ry} transform={`rotate(${t.tilt} ${t.cx} ${t.cy})`}
                vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          <svg className="hero-markers" viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true">
            {MARKERS.map((m, i) => {
              const p = pointOn(TRACKS[m.track], m.angle);
              return <circle key={i} cx={p.x} cy={p.y} r="3.2" />;
            })}
          </svg>

          <div className="hero-words" aria-hidden="true">
            <span className="hero-ghost">{WORD}</span>
            <span className="hero-word-spacer">{WORD}</span>
            <span className="hero-ghost">{WORD}</span>
          </div>
          <h1 className="hero-word">{WORD}</h1>

          {CARDS.map((c, i) => (
            <div key={c.icon} className="hero-card" ref={(n) => { cards.current[i] = n; }}
              style={{ width: c.size, height: c.size * 1.08 }} aria-hidden="true">
              <span className="hero-card-icon" style={{ background: c.color, color: c.color === '#C6F432' ? '#111' : '#fff' }}>
                <Icon name={c.icon} size={Math.round(c.size * 0.3)} />
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
