import { useId } from 'react';
import '../styles/ring-intro.css';

/** Original ring-of-script lettering used by the intro and the emblem. */
export const RING_TEXT =
  'Gather the company and share the road ✦ every word a lantern kept against the dark ✦ many voices, one table, one fellowship ✦ ';

/**
 * Fellowship emblem: antique-gold calligraphy circling a monogram, slowly turning.
 * Used as the top-left brand mark in place of the old logo + wordmark.
 */
export function RingEmblem({ size = 44, spin = true }: { size?: number; spin?: boolean }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={`ring-emblem${spin ? ' spin' : ''}`} width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Fellowship">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F3DC9A" />
          <stop offset="0.45" stopColor="#C9973E" />
          <stop offset="0.7" stopColor="#F0CF85" />
          <stop offset="1" stopColor="#8E6A2C" />
        </linearGradient>
        <path id={`p${id}`} d="M50,50 m-37,0 a37,37 0 1,1 74,0 a37,37 0 1,1 -74,0" />
      </defs>
      <circle cx="50" cy="50" r="49" fill="#0D0C0B" />
      <g className="ring-emblem-ring">
        <text fill={`url(#g${id})`} fontFamily="'Pinyon Script', cursive" fontSize="11.5">
          <textPath href={`#p${id}`} textLength="232" lengthAdjust="spacingAndGlyphs">{RING_TEXT.slice(0, 54)}</textPath>
        </text>
      </g>
      <text x="50" y="50" dy="0.35em" textAnchor="middle" fill={`url(#g${id})`}
        fontFamily="'Cinzel', serif" fontWeight="700" fontSize="34">F</text>
    </svg>
  );
}
