import { useEffect, useRef } from 'react';
import { CATEGORIES } from './content';

/** Deterministic pseudo-random numbers so the layout is stable between renders. */
function rng(seed: number) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

interface Hub { label: string; count: number; x: number; y: number; spokes: { a: number; r: number; kind: number; label: string }[] }

/**
 * Hero panel: each Fellowship area is a hub with small nodes on spokes; hubs are linked to each other,
 * and pulses travel along the lines like messages moving through the team.
 */
export function Constellation() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rand = rng(42);
    // Hubs on a loose grid, in normalised 0..1 space.
    const spots = [[0.2, 0.22], [0.52, 0.16], [0.82, 0.27], [0.33, 0.5], [0.68, 0.52], [0.16, 0.78], [0.5, 0.8], [0.85, 0.76]];
    const hubs: Hub[] = CATEGORIES.map((c, i) => {
      // Each node stands for a real feature of that area, shown on hover.
      const names = [...c.features.map((f) => f.title), ...c.notes];
      return {
      label: c.name,
      count: names.length,
      x: spots[i][0] + (rand() - 0.5) * 0.05,
      y: spots[i][1] + (rand() - 0.5) * 0.05,
      spokes: Array.from({ length: 9 + Math.floor(rand() * 7) }, (_, k) => ({ a: rand() * Math.PI * 2, r: 0.05 + rand() * 0.09, kind: Math.floor(rand() * 3), label: names[k % names.length] })),
    }; });
    const links: [number, number][] = [[0, 1], [1, 2], [0, 3], [1, 3], [1, 4], [2, 4], [3, 4], [3, 5], [3, 6], [4, 6], [4, 7], [5, 6], [6, 7]];
    type Pulse = { from: number; to: number; t: number; speed: number };
    const pulses: Pulse[] = [];
    let w = 0, h = 0, raf = 0, visible = true;
    // Pointer hover: nearest node within reach gets its spoke highlighted and its feature named.
    let mouse: { x: number; y: number } | null = null;
    let hover: { hub: number; spoke: number } | null = null;
    const onMove = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; if (reduce) draw(0); };
    const onLeave = () => { mouse = null; hover = null; if (reduce) draw(0); };
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerleave', onLeave);

    const resize = () => {
      const r = cv.getBoundingClientRect();
      w = r.width; h = r.height;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(() => { resize(); if (reduce) draw(0); });
    ro.observe(cv);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(cv);

    const pos = (hub: Hub) => ({ x: hub.x * w, y: hub.y * h });
    const unit = () => Math.min(w, h * 1.6);

    function draw(time: number) {
      ctx.clearRect(0, 0, w, h);
      const u = unit();
      // Links between hubs.
      ctx.lineWidth = 1;
      for (const [a, b] of links) {
        const p = pos(hubs[a]), q = pos(hubs[b]);
        ctx.strokeStyle = 'rgba(120, 150, 255, 0.16)';
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
      // Spokes and their nodes, slowly turning.
      let best = 18 * 18; hover = null;
      const nodeAt = (hi: number, si: number) => { const hub = hubs[hi], c = pos(hub), s = hub.spokes[si], a = s.a + time * 0.00004 * (hi % 2 ? 1 : -1); return { c, x: c.x + Math.cos(a) * s.r * u, y: c.y + Math.sin(a) * s.r * u }; };
      if (mouse) hubs.forEach((hub, hi) => hub.spokes.forEach((_, si) => { const n = nodeAt(hi, si); const d = (n.x - mouse!.x) ** 2 + (n.y - mouse!.y) ** 2; if (d < best) { best = d; hover = { hub: hi, spoke: si }; } }));
      hubs.forEach((hub, hi) => {
        const c = pos(hub);
        const turn = time * 0.00004 * (hi % 2 ? 1 : -1);
        for (const s of hub.spokes) {
          const a = s.a + turn;
          const x = c.x + Math.cos(a) * s.r * u, y = c.y + Math.sin(a) * s.r * u;
          const g = ctx.createLinearGradient(c.x, c.y, x, y);
          g.addColorStop(0, 'rgba(140, 170, 255, 0.55)');
          g.addColorStop(1, 'rgba(140, 170, 255, 0.08)');
          ctx.strokeStyle = g;
          ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(x, y); ctx.stroke();
          // Node: a tiny "message", "file" or "person" chip.
          ctx.fillStyle = s.kind === 0 ? 'rgba(255,255,255,0.85)' : s.kind === 1 ? 'rgba(170,200,255,0.8)' : 'rgba(255,214,140,0.85)';
          if (s.kind === 2) { ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill(); }
          else { ctx.fillRect(x - 4, y - 3, 8, 6); ctx.fillStyle = 'rgba(10,20,60,0.8)'; ctx.fillRect(x - 2.5, y - 1, 5, 1.2); }
        }
      });
      // Pulses travelling hub to hub.
      for (const p of pulses) {
        const a = pos(hubs[p.from]), b = pos(hubs[p.to]);
        const x = a.x + (b.x - a.x) * p.t, y = a.y + (b.y - a.y) * p.t;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, 10);
        glow.addColorStop(0, 'rgba(160, 255, 210, 0.9)');
        glow.addColorStop(1, 'rgba(160, 255, 210, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
      }
      // Hovered node: bright spoke, ring and a label chip with the feature name.
      if (hover) {
        const { hub: hi, spoke: si } = hover;
        const n = nodeAt(hi, si);
        ctx.strokeStyle = '#7CFFC4'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(n.c.x, n.c.y); ctx.lineTo(n.x, n.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(n.x, n.y, 6, 0, Math.PI * 2); ctx.stroke();
        const text = hubs[hi].spokes[si].label;
        ctx.font = "400 12px 'IBM Plex Mono', ui-monospace, monospace";
        const tw = ctx.measureText(text).width;
        const bx = Math.min(n.x + 10, w - tw - 16), by = Math.max(n.y - 26, 4);
        ctx.fillStyle = '#2547F5'; ctx.fillRect(bx, by, tw + 12, 20);
        ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + 6, by + 10);
        ctx.lineWidth = 1;
      }
      // Hubs and labels on top.
      ctx.font = `400 ${Math.max(10, Math.min(13, u / 70))}px 'IBM Plex Mono', ui-monospace, monospace`;
      ctx.textBaseline = 'middle';
      hubs.forEach((hub, i) => {
        const c = pos(hub);
        const breathe = reduce ? 1 : 1 + 0.15 * Math.sin(time / 900 + i);
        const halo = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 18 * breathe);
        halo.addColorStop(0, 'rgba(120, 255, 200, 0.55)');
        halo.addColorStop(1, 'rgba(120, 255, 200, 0)');
        ctx.fillStyle = halo;
        ctx.beginPath(); ctx.arc(c.x, c.y, 18 * breathe, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#B9FFE0';
        ctx.beginPath(); ctx.arc(c.x, c.y, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(235, 240, 255, 0.92)';
        ctx.fillText(hub.label, c.x + 9, c.y - 12);
        ctx.fillStyle = 'rgba(235, 240, 255, 0.55)';
        ctx.fillText(String(hub.count), c.x + 13 + ctx.measureText(hub.label).width, c.y - 16);
      });
    }

    let last = performance.now(), spawnAcc = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (visible && !document.hidden) {
        spawnAcc += dt;
        if (spawnAcc > 0.35 && pulses.length < 14) {
          spawnAcc = 0;
          const [a, b] = links[Math.floor(Math.random() * links.length)];
          pulses.push(Math.random() < 0.5 ? { from: a, to: b, t: 0, speed: 0.35 + Math.random() * 0.3 } : { from: b, to: a, t: 0, speed: 0.35 + Math.random() * 0.3 });
        }
        for (let i = pulses.length - 1; i >= 0; i--) {
          pulses[i].t += pulses[i].speed * dt;
          if (pulses[i].t >= 1) pulses.splice(i, 1);
        }
        draw(now);
      }
      raf = requestAnimationFrame(frame);
    };
    if (reduce) draw(0); else raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); cv.removeEventListener('pointermove', onMove); cv.removeEventListener('pointerleave', onLeave); };
  }, []);

  return <canvas ref={ref} className="ed-constellation" aria-label="Fellowship's areas connected, with activity moving between them" role="img" />;
}
