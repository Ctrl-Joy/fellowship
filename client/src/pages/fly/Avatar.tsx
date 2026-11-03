/** Original, procedurally drawn teammate portraits (SVG), stable per seed. */

const HEADS = ['#F28C38', '#7BC96F', '#59B7C9', '#E8618C', '#8E7BE8', '#F2C14E', '#4F8FE8', '#E85C4F', '#62D2A2', '#C77DDB'];
const HAIR = ['#2B1B12', '#E8D7B0', '#C6452B', '#1F2A44', '#F2E6D8', '#6B3E26', '#EE7FB0', '#3E3E3E'];
const SHIRT = ['#EDE6DA', '#D9DEE6', '#E9DDD0', '#2F3540', '#CFE3DA', '#E6D3E0'];
const TILE = [['#F6D7C3', '#E9B79A'], ['#E8D9C8', '#D2BBA2'], ['#F3CFC7', '#DFA79C'], ['#E2D6E9', '#C7B4D6'], ['#D7E4E1', '#B5CCC7']];

/** mulberry32: well-mixed, so neighbouring seeds don't produce look-alike portraits. */
function rng(seed: number) {
  let a = (seed * 0x9E3779B1) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function Avatar({ seed, className }: { seed: number; className?: string }) {
  // Colours step through their palettes by seed (co-prime strides), so neighbours never look alike;
  // only the hairstyle is random.
  const r = rng(seed + 7);
  const at = <T,>(a: T[], stride: number) => a[(seed * stride) % a.length];
  const head = at(HEADS, 7), hair = at(HAIR, 3), shirt = at(SHIRT, 5), [t1, t2] = at(TILE, 2);
  const style = Math.floor(r() * 4);
  const id = `av${seed}`;
  return (
    <svg className={className} viewBox="0 0 80 96" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={t1} /><stop offset="1" stopColor={t2} /></linearGradient>
        <radialGradient id={`${id}h`} cx="0.38" cy="0.32" r="0.8"><stop offset="0" stopColor="#fff" stopOpacity="0.35" /><stop offset="0.5" stopColor="#fff" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="80" height="96" fill={`url(#${id}t)`} />
      {/* shoulders */}
      <path d="M10 96 C12 74 26 66 40 66 C54 66 68 74 70 96 Z" fill={shirt} />
      <path d="M33 66 L40 78 L47 66" fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="1.5" />
      {/* neck + head */}
      <rect x="34" y="54" width="12" height="14" rx="5" fill={head} />
      <ellipse cx="40" cy="40" rx="17" ry="19" fill={head} />
      <ellipse cx="40" cy="40" rx="17" ry="19" fill={`url(#${id}h)`} />
      {/* hair styles */}
      {style === 0 && <path d="M22 38 C21 20 33 15 41 16 C52 16 60 24 58 38 C54 30 46 27 40 27 C33 27 26 31 22 38 Z" fill={hair} />}
      {style === 1 && <path d="M21 44 C18 22 30 14 40 14 C52 14 63 22 59 44 L56 58 C55 42 52 30 40 29 C29 29 25 42 24 58 Z" fill={hair} />}
      {style === 2 && <g fill={hair}>{[0, 1, 2, 3, 4, 5, 6].map((k) => <circle key={k} cx={25 + k * 5} cy={21 + Math.abs(3 - k) * 1.6} r="5.2" />)}</g>}
      {style === 3 && <path d="M24 33 C24 20 34 17 40 17 C47 17 57 20 56 33 L48 28 L40 32 L32 27 Z" fill={hair} />}
      {/* face */}
      <circle cx="34" cy="42" r="2" fill="#1B1B1B" />
      <circle cx="46" cy="42" r="2" fill="#1B1B1B" />
      <path d="M35 50 Q40 54 45 50" fill="none" stroke="#1B1B1B" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
