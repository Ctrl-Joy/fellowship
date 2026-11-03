import { RingEmblem } from './RingEmblem';

/** Fellowship mark: three linked rings. Original artwork. */
export function LogoMark({ size = 32, framed = true }: { size?: number; framed?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Fellowship" role="img">
      {framed && <rect width="64" height="64" rx="14" fill="var(--brand)" />}
      <g fill="none" strokeWidth="5">
        <circle cx="32" cy="23" r="11" stroke="var(--accent)" />
        <circle cx="23" cy="39" r="11" stroke={framed ? '#fff' : 'var(--brand)'} />
        <circle cx="41" cy="39" r="11" stroke="#9FD8C6" />
      </g>
    </svg>
  );
}

/** Top-left brand mark: the turning gold ring emblem. */
export function Wordmark({ size = 28 }: { size?: number }) {
  return <span className="wordmark"><RingEmblem size={Math.round(size * 1.6)} /></span>;
}
