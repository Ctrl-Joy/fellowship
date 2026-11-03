/** Fellowship mark: three linked rings. Original artwork. */
export function LogoMark({ size = 32, framed = true }: { size?: number; framed?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Fellowship" role="img">
      {framed && <rect width="64" height="64" rx="14" fill="#1A1A17" />}
      <g fill="none" strokeWidth="5">
        <circle cx="32" cy="23" r="11" stroke="#FA4C0D" />
        <circle cx="23" cy="39" r="11" stroke="#FA4C0D" />
        <circle cx="41" cy="39" r="11" stroke="#FA4C0D" />
      </g>
    </svg>
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size * 0.72 }}>
      <LogoMark size={size} />
      <span>Fellowship</span>
    </span>
  );
}

/** Orange three-ring mark with the spaced FELLOWSHIP wordmark, as on the landing page. */
export function BrandLockup({ className = '' }: { className?: string }) {
  return (
    <span className={`brand-lockup ${className}`.trim()}>
      <svg width="26" height="23" viewBox="4 3 56 50" fill="none" stroke="#FA4C0D" strokeWidth="6" aria-hidden="true">
        <circle cx="32" cy="20" r="11" /><circle cx="23" cy="36" r="11" /><circle cx="41" cy="36" r="11" />
      </svg>
      FELLOWSHIP
    </span>
  );
}
