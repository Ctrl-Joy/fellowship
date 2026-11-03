import { useEffect, useRef } from 'react';

function rng(seed: number) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

/**
 * Interlude close-up of one area's hub. Spokes grow out to their nodes as the interlude scrolls
 * (progress is read from the closest `[data-progress]` ancestor), one spoke is highlighted, and the
 * whole burst turns slowly.
 */
export function HubBurst({ seed, accent }: { seed: number; accent: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    const host = cv.closest<HTMLElement>('[data-progress]');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rand = rng(seed * 7919 + 13);
    const spokes = Array.from({ length: 34 }, (_, i) => ({
      a: (i / 34) * Math.PI * 2 + (rand() - 0.5) * 0.25,
      r: 0.22 + rand() * 0.5,
      kind: rand() < 0.22 ? 'rect' : 'ring',
      delay: rand() * 0.35,
    }));
    const hot = Math.floor(rand() * spokes.length);
    spokes[hot].r = 0.78;
    let w = 0, h = 0, raf = 0, visible = false;

    const resize = () => {
      const r = cv.getBoundingClientRect();
      w = r.width; h = r.height;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) raf = requestAnimationFrame(frame); });
    io.observe(cv);

    function frame(now: number) {
      raf = 0;
      if (!visible) return;
      const p = reduce ? 1 : Number(host?.dataset.progress ?? 1);
      const cx = w * 0.56, cy = h * 0.38, R = Math.max(w, h) * 0.62;
      const turn = reduce ? 0 : now * 0.000025;
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < spokes.length; i++) {
        const s = spokes[i];
        const grow = Math.min(1, Math.max(0, (p * 1.6 - s.delay) / 0.6));
        if (grow <= 0) continue;
        const a = s.a + turn;
        const len = s.r * R * grow;
        const x = cx + Math.cos(a) * len, y = cy + Math.sin(a) * len;
        const isHot = i === hot;
        ctx.strokeStyle = isHot ? accent : 'rgba(255,255,255,0.32)';
        ctx.lineWidth = isHot ? 1.6 : 0.8;
        if (!isHot && i % 3 === 0) ctx.setLineDash([2, 4]); else ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
        ctx.setLineDash([]);
        if (grow >= 1) {
          ctx.strokeStyle = isHot ? accent : 'rgba(255,255,255,0.75)';
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          if (s.kind === 'rect') { ctx.lineWidth = 1; ctx.strokeRect(x - 7, y - 5, 14, 10); ctx.fillRect(x - 4, y - 1.5, 8, 1.5); }
          else { ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.stroke(); }
        }
      }
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fill();
      if (!reduce) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, [seed, accent]);

  return <canvas ref={ref} className="ed-burst" aria-hidden="true" />;
}
