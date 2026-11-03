import { useEffect, useRef, type MutableRefObject } from 'react';
import { CATEGORIES } from './content';

/** Shared with the page: how far the hero has dived (0..1) and the current page colour. */
export interface DiveState {
  p: number;
  page: [number, number, number];
  /** Insets of the visible window inside the canvas (the panel's box while not diving). */
  view: { t: number; r: number; b: number; l: number };
}

function rng(seed: number) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

// World space the camera moves through. Wider than any screen, so there is always room to pan sideways.
const WORLD_W = 2000, WORLD_H = 1150;
const SPOTS: [number, number][] = [[380, 300], [930, 210], [1560, 330], [640, 640], [1250, 640], [300, 930], [960, 960], [1680, 900]];

interface Node { hub: number; a: number; r: number; kind: number; label: string; mass: number; phase: number; ox: number; oy: number; vx: number; vy: number }

/**
 * Hero map of Fellowship's areas. Pan it sideways (trackpad, shift+wheel or drag): the camera eases on a
 * spring and every spoke node hangs on its own spring, so motion ripples through the network like a wave.
 * Scrolling the page down "dives" into the first hub. Everything is drawn on one canvas, once per frame.
 */
export function NetworkMap({ dive }: { dive: MutableRefObject<DiveState> }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d', { alpha: false })!;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rand = rng(42);

    const hubs = CATEGORIES.map((c, i) => ({
      x: SPOTS[i][0] + (rand() - 0.5) * 60, y: SPOTS[i][1] + (rand() - 0.5) * 60,
      label: c.name, count: c.features.length + c.notes.length,
    }));
    const nodes: Node[] = [];
    CATEGORIES.forEach((c, hi) => {
      const names = [...c.features.map((f) => f.title), ...c.notes];
      const n = 12 + Math.floor(rand() * 10);
      for (let k = 0; k < n; k++) {
        const r = 60 + rand() * 150;
        nodes.push({ hub: hi, a: rand() * Math.PI * 2, r, kind: rand() < 0.28 ? 1 : 0, label: names[k % names.length],
          mass: 0.5 + r / 160, phase: rand() * Math.PI * 2, ox: 0, oy: 0, vx: 0, vy: 0 });
      }
    });
    const PX = new Float32Array(nodes.length), PY = new Float32Array(nodes.length);
    const core = { x: WORLD_W / 2, y: WORLD_H / 2 + 20 };
    const links: [number, number][] = [[0, 1], [1, 2], [0, 3], [1, 3], [1, 4], [2, 4], [3, 4], [3, 5], [3, 6], [4, 6], [4, 7], [5, 6], [6, 7]];
    const dust = Array.from({ length: 70 }, () => ({ x: rand() * WORLD_W, y: rand() * WORLD_H, s: 0.6 + rand() * 1.2 }));
    type Pulse = { from: number; to: number; t: number; speed: number };
    const pulses: Pulse[] = [];

    // A soft glow, rendered once and stamped with drawImage (no gradients allocated per frame).
    const glow = document.createElement('canvas');
    glow.width = glow.height = 64;
    { const g = glow.getContext('2d')!; const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(124,255,196,0.75)'); gr.addColorStop(1, 'rgba(124,255,196,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }

    // Camera: position follows a target on an underdamped spring (eases in, overshoots a touch, settles).
    const cam = { x: WORLD_W / 2, y: WORLD_H / 2, vx: 0, vy: 0, tx: WORLD_W / 2, ty: WORLD_H / 2 };
    let w = 0, h = 0, base = 1, raf = 0, visible = true, last = performance.now();
    let mouse: { x: number; y: number } | null = null;
    let drag: { x: number; y: number; tx: number; ty: number } | null = null;

    const resize = () => {
      const r = cv.getBoundingClientRect();
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    // The visible window inside the canvas: the panel's box, opening up to the full canvas during the dive.
    let vx = 0, vy = 0, vw = 1, vh = 1;
    const updateView = () => {
      const v = dive.current.view;
      vx = v.l; vy = v.t; vw = Math.max(1, w - v.l - v.r); vh = Math.max(1, h - v.t - v.b);
      base = Math.max(vw / (WORLD_W * 0.62), vh / (WORLD_H * 0.78));
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(cv);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); } });
    io.observe(cv);

    const clampTarget = () => {
      // Keep the visible window inside the world (with a small margin past the outermost hubs).
      const halfW = vw / (2 * base), halfH = vh / (2 * base), m = 80;
      cam.tx = Math.min(WORLD_W + m - halfW, Math.max(halfW - m, cam.tx));
      cam.ty = Math.min(WORLD_H + m - halfH, Math.max(halfH - m, cam.ty));
    };
    // Horizontal intent pans the map; plain vertical scrolling is left to the page.
    const onWheel = (e: WheelEvent) => {
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (!dx || dive.current.p > 0.05) return;
      e.preventDefault();
      cam.tx += dx / base; clampTarget();
    };
    const onDown = (e: PointerEvent) => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, tx: cam.tx, ty: cam.ty }; cv.setPointerCapture(e.pointerId); };
    const onMove = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (drag) { cam.tx = drag.tx - (e.clientX - drag.x) / base; cam.ty = drag.ty - (e.clientY - drag.y) / base; clampTarget(); }
    };
    const onUp = () => { drag = null; };
    const onLeave = () => { mouse = null; };
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('pointerleave', onLeave);

    function frame(now: number) {
      raf = 0;
      if (!visible) return;
      const dt = Math.min(2, (now - last) / 16.667); // frames elapsed at 60 Hz, so physics is refresh-rate independent
      last = now;
      const { p, page } = dive.current;
      updateView();

      // --- camera spring (+ a gentle lean toward the pointer, + the scroll dive toward the first hub) ---
      const lean = mouse && !drag && !reduce ? { x: ((mouse.x - vx) / vw - 0.5) * 60, y: ((mouse.y - vy) / vh - 0.5) * 40 } : { x: 0, y: 0 };
      const ease = p * p * (3 - 2 * p);
      const gx = (cam.tx + lean.x) * (1 - ease) + hubs[0].x * ease;
      const gy = (cam.ty + lean.y) * (1 - ease) + hubs[0].y * ease;
      const ax = ((gx - cam.x) * 0.045 - cam.vx * 0.2) * dt;
      const ay = ((gy - cam.y) * 0.045 - cam.vy * 0.2) * dt;
      if (reduce) { cam.x = gx; cam.y = gy; cam.vx = cam.vy = 0; }
      else {
        cam.vx += ax; cam.vy += ay;
        const sp = Math.hypot(cam.vx, cam.vy), maxSp = 38; // world units per frame
        if (sp > maxSp) { cam.vx *= maxSp / sp; cam.vy *= maxSp / sp; }
        cam.x += cam.vx * dt; cam.y += cam.vy * dt;
      }
      const zoom = base * (1 + ease * 1.8);

      // --- node springs: they lag the camera's acceleration, then swing back (the "wave") ---
      const t = now / 1000;
      if (!reduce) for (const n of nodes) {
        const fx = -n.ox * 0.08 - n.vx * 0.14 + ax * n.mass * 1.2;
        const fy = -n.oy * 0.08 - n.vy * 0.14 + ay * n.mass * 1.2;
        n.vx += fx * dt; n.vy += fy * dt; n.ox += n.vx * dt; n.oy += n.vy * dt;
        // Cap the swing (longer spokes may swing a little further) so a hard flick never smears the map.
        const cap = 18 + n.r * 0.12, d = Math.hypot(n.ox, n.oy);
        if (d > cap) { const k = cap / d; n.ox *= k; n.oy *= k; n.vx *= 0.6; n.vy *= 0.6; }
      }

      const sx = (x: number) => (x - cam.x) * zoom + vx + vw / 2;
      const sy = (y: number) => (y - cam.y) * zoom + vy + vh / 2;
      // Node screen positions into reused typed arrays (no per-frame allocation, so no GC hitches).
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i], hub = hubs[n.hub];
        // Idle ripple: a slow wave travelling outward along each spoke.
        const wave = reduce ? 0 : Math.sin(t * 1.3 - n.r / 45 + n.phase) * (n.r / 30);
        const a = n.a + (reduce ? 0 : t * 0.02 * (n.hub % 2 ? 1 : -1));
        PX[i] = sx(hub.x + Math.cos(a) * n.r - Math.sin(a) * wave + n.ox);
        PY[i] = sy(hub.y + Math.sin(a) * n.r + Math.cos(a) * wave + n.oy);
      }

      // --- background: night blue blending into the page colour as we dive ---
      const bg = [2, 4, 15].map((v, i) => Math.round(v + (page[i] - v) * ease));
      ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      for (const d of dust) { const x = sx(d.x), y = sy(d.y); if (x > -4 && x < w + 4 && y > -4 && y < h + 4) ctx.fillRect(x, y, d.s, d.s); }

      // Links (hub to hub, hub to core), one path.
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(120,150,255,0.16)';
      ctx.beginPath();
      for (const [a, b] of links) { ctx.moveTo(sx(hubs[a].x), sy(hubs[a].y)); ctx.lineTo(sx(hubs[b].x), sy(hubs[b].y)); }
      for (const hub of hubs) { ctx.moveTo(sx(core.x), sy(core.y)); ctx.lineTo(sx(hub.x), sy(hub.y)); }
      ctx.stroke();

      // Spokes, one path; then nodes.
      ctx.strokeStyle = 'rgba(140,170,255,0.32)';
      ctx.beginPath();
      nodes.forEach((n, i) => { ctx.moveTo(sx(hubs[n.hub].x), sy(hubs[n.hub].y)); ctx.lineTo(PX[i], PY[i]); });
      ctx.stroke();
      let hover = -1, best = 18 * 18;
      nodes.forEach((n, i) => {
        const x = PX[i], y = PY[i];
        if (x < -10 || x > w + 10 || y < -10 || y > h + 10) return;
        if (mouse && !drag) { const d = (x - mouse.x) ** 2 + (y - mouse.y) ** 2; if (d < best) { best = d; hover = i; } }
        if (n.kind) { ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fillRect(x - 5, y - 4, 10, 8); ctx.fillStyle = 'rgba(10,20,60,0.85)'; ctx.fillRect(x - 3, y - 1, 6, 1.4); }
        else { ctx.fillStyle = 'rgba(150,175,255,0.9)'; ctx.fillRect(x - 1.5, y - 1.5, 3, 3); }
      });

      // Pulses travelling hub to hub.
      for (const pl of pulses) {
        const a = hubs[pl.from], b = hubs[pl.to];
        const x = sx(a.x + (b.x - a.x) * pl.t), y = sy(a.y + (b.y - a.y) * pl.t);
        ctx.drawImage(glow, x - 11, y - 11, 22, 22);
      }

      // Hubs with breathing glow, label and feature count.
      ctx.font = "400 12px 'IBM Plex Mono', ui-monospace, monospace";
      ctx.textBaseline = 'middle';
      hubs.forEach((hub, i) => {
        const x = sx(hub.x), y = sy(hub.y);
        const s = 34 * (reduce ? 1 : 1 + 0.15 * Math.sin(t * 1.1 + i));
        ctx.drawImage(glow, x - s / 2, y - s / 2, s, s);
        ctx.fillStyle = '#B9FFE0'; ctx.fillRect(x - 3, y - 3, 6, 6);
        ctx.fillStyle = 'rgba(235,240,255,0.92)'; ctx.fillText(hub.label, x + 9, y - 12);
        ctx.fillStyle = 'rgba(235,240,255,0.5)'; ctx.fillText(String(hub.count), x + 14 + ctx.measureText(hub.label).width, y - 16);
      });
      ctx.fillStyle = 'rgba(160,180,255,0.9)'; ctx.beginPath(); ctx.arc(sx(core.x), sy(core.y), 3.5, 0, Math.PI * 2); ctx.fill();

      // Hovered node: bright spoke, ring and the feature it stands for.
      cv.style.cursor = drag ? 'grabbing' : hover >= 0 ? 'pointer' : 'grab';
      if (hover >= 0) {
        const n = nodes[hover], x = PX[hover], y = PY[hover];
        ctx.strokeStyle = '#7CFFC4'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(sx(hubs[n.hub].x), sy(hubs[n.hub].y)); ctx.lineTo(x, y); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
        const tw = ctx.measureText(n.label).width;
        const bx = Math.min(x + 12, w - tw - 16), by = Math.max(y - 28, 4);
        ctx.fillStyle = '#2547F5'; ctx.fillRect(bx, by, tw + 12, 20);
        ctx.fillStyle = '#fff'; ctx.fillText(n.label, bx + 6, by + 10);
      }

      // Spawn / advance pulses.
      if (!reduce) {
        if (pulses.length < 14 && Math.random() < 0.05 * dt) {
          const [a, b] = links[Math.floor(Math.random() * links.length)];
          pulses.push(Math.random() < 0.5 ? { from: a, to: b, t: 0, speed: 0.006 + Math.random() * 0.005 } : { from: b, to: a, t: 0, speed: 0.006 + Math.random() * 0.005 });
        }
        for (let i = pulses.length - 1; i >= 0; i--) { pulses[i].t += pulses[i].speed * dt; if (pulses[i].t >= 1) pulses.splice(i, 1); }
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      cv.removeEventListener('wheel', onWheel);
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointercancel', onUp);
      cv.removeEventListener('pointerleave', onLeave);
    };
  }, [dive]);

  return <canvas ref={ref} className="ed-map" role="img" aria-label="Map of Fellowship's areas. Scroll sideways or drag to explore; point at a node to see the feature." />;
}
