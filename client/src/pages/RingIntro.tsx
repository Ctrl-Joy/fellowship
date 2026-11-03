import { useEffect, useRef } from 'react';
import { RING_TEXT } from '../components/RingEmblem';
import '../styles/ring-intro.css';

/** Ring geometry in the SVG's 1000×1000 space; the canvas uses the same proportions. */
const R = 330;
const CIRCUMFERENCE = 2 * Math.PI * R;
/** Seconds per full turn of the lettering (slow and ceremonial). */
const TURN_SECONDS = 140;

type Particle = {
  kind: 'smoke' | 'ember';
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number; grow: number; alpha: number; seed: number;
};

/** A soft golden puff, pre-rendered once so each smoke particle is a single drawImage. */
function makeSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255, 214, 140, 0.55)');
  grad.addColorStop(0.35, 'rgba(226, 168, 78, 0.22)');
  grad.addColorStop(1, 'rgba(160, 100, 30, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}

/**
 * Cinematic opening: antique-gold calligraphy turning around "Fellowship", with golden
 * fog, drifting embers and faint trails rising from the letters.
 */
export function RingIntro({ onEnter }: { onEnter(): void }) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = stage.current, cv = canvas.current;
    if (!el || !cv) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const ctx = cv.getContext('2d')!;
    const sprite = makeSprite();
    let w = 0, h = 0, scale = 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const resize = () => {
      const r = el.getBoundingClientRect();
      w = r.width; h = r.height; scale = w / 1000;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // Fewer particles on small screens; none at all when motion is reduced.
    const budget = () => (reduce ? 0 : w < 480 ? 0.55 : 1);
    const parts: Particle[] = [];
    const spawn = (kind: Particle['kind']) => {
      const a = Math.random() * Math.PI * 2;
      const rr = (R + (Math.random() - 0.5) * 34) * scale;
      const x = w / 2 + Math.cos(a) * rr, y = h / 2 + Math.sin(a) * rr;
      // Tangential push follows the ring's clockwise turn, so smoke trails behind the letters.
      const tang = ((2 * Math.PI * R) / TURN_SECONDS / 60) * scale * 6;
      const out = kind === 'ember' ? 0.18 : 0.08;
      parts.push({
        kind, x, y,
        vx: -Math.sin(a) * tang + Math.cos(a) * out * scale * 3,
        vy: Math.cos(a) * tang + Math.sin(a) * out * scale * 3 - (kind === 'ember' ? 0.32 : 0.16) * Math.max(scale, 0.5) * 2,
        life: 0,
        max: kind === 'ember' ? 2.5 + Math.random() * 3 : 4 + Math.random() * 4,
        size: kind === 'ember' ? 0.9 + Math.random() * 1.8 : (16 + Math.random() * 30) * Math.max(scale, 0.45),
        grow: kind === 'ember' ? 0 : 6 + Math.random() * 10,
        alpha: kind === 'ember' ? 0.75 + Math.random() * 0.25 : 0.12 + Math.random() * 0.14,
        seed: Math.random() * 1000,
      });
    };

    let raf = 0, last = performance.now(), visible = true, acc = 0;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(el);

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (visible && !document.hidden) {
        const b = budget();
        acc += dt;
        // ~36 smoke puffs and ~19 embers per second at full budget, capped overall.
        while (acc > 1 / 55) {
          acc -= 1 / 55;
          if (parts.length < 240 * b) spawn(Math.random() < 0.35 ? 'ember' : 'smoke');
        }
        ctx.clearRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i];
          p.life += dt;
          if (p.life >= p.max) { parts.splice(i, 1); continue; }
          const t = p.life / p.max;
          // Turbulence: a slow sinusoidal sway per particle.
          const sway = Math.sin(now / 900 + p.seed) * 0.25 * scale * 2;
          p.x += (p.vx + sway) * dt * 60;
          p.y += p.vy * dt * 60;
          p.vy -= 0.0008 * dt * 60; // gentle buoyancy
          const fade = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
          if (p.kind === 'smoke') {
            const s = p.size + p.grow * t * Math.max(scale, 0.45) * 3;
            ctx.globalAlpha = p.alpha * fade;
            ctx.drawImage(sprite, p.x - s, p.y - s, s * 2, s * 2);
          } else {
            const flicker = 0.65 + 0.35 * Math.sin(now / 70 + p.seed);
            ctx.globalAlpha = p.alpha * fade * flicker;
            ctx.fillStyle = '#FFD98C';
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(frame);
    };
    if (!reduce) raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, []);

  return (
    <section className="ri" aria-label="Fellowship">
      <div className="ri-stage" ref={stage}>
        <svg className="ri-svg" viewBox="0 0 1000 1000" aria-hidden="true">
          <defs>
            <linearGradient id="ri-gold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#F6E2A6" />
              <stop offset="0.3" stopColor="#C8923A" />
              <stop offset="0.55" stopColor="#F2D188" />
              <stop offset="0.8" stopColor="#9C7330" />
              <stop offset="1" stopColor="#E9C677" />
            </linearGradient>
            <filter id="ri-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
              <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0.25  0 0.8 0 0 0.12  0 0 0.4 0 0  0 0 0 0.9 0" result="warm" />
              <feMerge><feMergeNode in="warm" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <path id="ri-path" d={`M500,500 m-${R},0 a${R},${R} 0 1,1 ${R * 2},0 a${R},${R} 0 1,1 -${R * 2},0`} />
          </defs>
          <g className="ri-ring" style={{ animationDuration: `${TURN_SECONDS}s` }}>
            <text className="ri-ring-text" fill="url(#ri-gold)" filter="url(#ri-glow)">
              <textPath href="#ri-path" textLength={CIRCUMFERENCE - 6} lengthAdjust="spacing">{RING_TEXT}</textPath>
            </text>
          </g>
        </svg>
        <canvas className="ri-smoke" ref={canvas} aria-hidden="true" />
        <h1 className="ri-title">Fellowship</h1>
      </div>
      <button className="ri-enter" onClick={onEnter}>
        Enter <span aria-hidden="true">↓</span>
      </button>
    </section>
  );
}
