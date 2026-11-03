import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Menu, X } from 'lucide-react';
import '../styles/lithos.css';

const BG_IMAGE_1 =
  'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260609_195923_b0ba8ace-1d1d-4f2c-9a28-1ab84b330680.png&w=1280&q=85';
const BG_IMAGE_2 =
  'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260609_201152_bba90a12-bf12-459f-91f0-51f237dbaf3b.png&w=1280&q=85';

const SPOTLIGHT_R = 260;

/** The soft spotlight: alpha 1 → 1 (40%) → 0.75 (60%) → 0.4 (75%) → 0.12 (88%) → 0 at SPOTLIGHT_R. */
function spotlightMask(x: number, y: number) {
  return `radial-gradient(circle ${SPOTLIGHT_R}px at ${x}px ${y}px, rgba(255,255,255,1) 0%, rgba(255,255,255,1) 40%, rgba(255,255,255,0.75) 60%, rgba(255,255,255,0.4) 75%, rgba(255,255,255,0.12) 88%, rgba(255,255,255,0) 100%)`;
}

/**
 * Second image shown only inside the soft circle that trails the cursor. The mask is a CSS radial
 * gradient with the same radius and stops as a canvas-drawn spotlight, applied straight to the element
 * each frame (no canvas export, no React re-render), so it stays smooth at any refresh rate.
 */
function RevealLayer({ image, layerRef }: { image: string; layerRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={layerRef}
      className="absolute inset-0 bg-center bg-cover bg-no-repeat z-30 pointer-events-none"
      style={{
        backgroundImage: `url("${image}")`,
        maskImage: spotlightMask(-999, -999),
        WebkitMaskImage: spotlightMask(-999, -999),
        maskSize: '100% 100%',
        WebkitMaskSize: '100% 100%',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
      }}
    />
  );
}

const NAV = ['Course', 'Field Guides', 'Geology', 'Plans', 'Live Tour'];

export function LithosLanding() {
  const mouse = useRef({ x: -999, y: -999 });
  const smooth = useRef({ x: -999, y: -999 });
  const rafRef = useRef(0);
  const layer = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const apply = () => {
      const el = layer.current;
      if (!el) return;
      const m = spotlightMask(smooth.current.x, smooth.current.y);
      el.style.maskImage = m;
      el.style.setProperty('-webkit-mask-image', m);
    };
    // Ease toward the pointer (10% of the gap per frame); stop the loop once it has caught up.
    const tick = () => {
      const s = smooth.current, t = mouse.current;
      s.x += (t.x - s.x) * 0.1;
      s.y += (t.y - s.y) * 0.1;
      apply();
      rafRef.current = Math.abs(t.x - s.x) > 0.1 || Math.abs(t.y - s.y) > 0.1 ? requestAnimationFrame(tick) : 0;
    };
    const onMove = (e: MouseEvent) => {
      // First move: start the spotlight at the cursor instead of sweeping in from off-screen.
      if (smooth.current.x === -999) smooth.current = { x: e.clientX, y: e.clientY };
      mouse.current = { x: e.clientX, y: e.clientY };
      if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
    };
    window.addEventListener('mousemove', onMove);
    return () => { window.removeEventListener('mousemove', onMove); cancelAnimationFrame(rafRef.current); };
  }, []);

  return (
    <div className="lithos min-h-screen bg-white tracking-[-0.02em]" style={{ fontFamily: "'Inter', sans-serif" }}>
      <nav className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-between p-4 sm:p-5">
        <Link to="/" className="flex items-center gap-2 no-underline">
          <svg width="26" height="26" viewBox="0 0 256 256" fill="#ffffff" aria-hidden="true">
            <path d="M 256 256 L 128 256 L 0 128 L 128 128 Z M 256 128 L 128 128 L 0 0 L 128 0 Z" />
          </svg>
          <span className="text-white text-2xl font-playfair italic">Lithos</span>
        </Link>

        <div className="hidden md:flex absolute left-1/2 -translate-x-1/2 bg-white/20 backdrop-blur-md border border-solid border-white/30 rounded-full px-2 py-2 items-center gap-1">
          {NAV.map((item, i) => (
            <button
              key={item}
              className={`px-4 py-1.5 rounded-full text-sm font-medium bg-transparent transition-colors ${i === 0 ? 'text-white' : 'text-white/80 hover:bg-white/20 hover:text-white'}`}
            >
              {item}
            </button>
          ))}
        </div>

        <Link to="/signup" className="hidden md:block bg-white text-gray-900 text-sm font-semibold px-6 py-2.5 rounded-full hover:bg-gray-100 no-underline">
          Sign Up
        </Link>

        <button
          className="md:hidden flex items-center justify-center w-10 h-10 rounded-full bg-white/20 backdrop-blur-md text-white"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        {menuOpen && (
          <div className="md:hidden absolute top-full left-4 right-4 mt-1 rounded-2xl bg-black/70 backdrop-blur-md border border-solid border-white/20 p-2 flex flex-col">
            {NAV.map((item, i) => (
              <button key={item} className={`text-left px-4 py-3 rounded-xl text-sm font-medium bg-transparent ${i === 0 ? 'text-white' : 'text-white/80 hover:bg-white/10'}`}>{item}</button>
            ))}
            <Link to="/signup" className="mt-2 text-center bg-white text-gray-900 text-sm font-semibold px-6 py-3 rounded-full no-underline">Sign Up</Link>
          </div>
        )}
      </nav>

      <section className="relative w-full overflow-hidden h-screen bg-black" style={{ height: '100dvh' }}>
        <div className="absolute inset-0 bg-center bg-cover bg-no-repeat z-10 hero-zoom" style={{ backgroundImage: `url("${BG_IMAGE_1}")` }} />

        <RevealLayer image={BG_IMAGE_2} layerRef={layer} />

        <div className="absolute top-[14%] left-0 right-0 flex flex-col items-center text-center px-5 pointer-events-none z-50">
          <h1 className="text-white leading-[0.95]">
            <span className="block font-playfair italic font-normal text-5xl sm:text-7xl md:text-8xl hero-anim hero-reveal" style={{ letterSpacing: '-0.05em', animationDelay: '0.25s' }}>
              Layers hold
            </span>
            <span className="block font-normal text-5xl sm:text-7xl md:text-8xl -mt-1 hero-anim hero-reveal" style={{ letterSpacing: '-0.08em', animationDelay: '0.42s' }}>
              tales of time
            </span>
          </h1>
        </div>

        <div className="hidden sm:block absolute bottom-14 left-10 md:left-14 max-w-[260px] z-50 hero-anim hero-fade" style={{ animationDelay: '0.7s' }}>
          <p className="text-sm text-white/80 leading-relaxed">
            Every layer of sediment records a chapter of our planet, from ancient seabeds to drifting ash, layered across millions of years beneath us.
          </p>
        </div>

        <div className="absolute bottom-10 sm:bottom-24 left-5 right-5 sm:left-auto sm:right-10 md:right-14 max-w-full sm:max-w-[260px] flex flex-col items-start gap-4 sm:gap-5 z-50 hero-anim hero-fade" style={{ animationDelay: '0.85s' }}>
          <p className="text-xs sm:text-sm text-white/80 leading-relaxed">
            Our interactive maps let you peel back the crust to trace how stones, fossils, and deep time combine to shape the ground beneath your feet.
          </p>
          <button className="bg-[#e8702a] hover:bg-[#d2611f] text-white text-sm font-medium px-7 py-3 rounded-full transition-all hover:scale-[1.03] active:scale-95 hover:shadow-lg hover:shadow-[#e8702a]/30">
            Start Digging
          </button>
        </div>
      </section>
    </div>
  );
}
