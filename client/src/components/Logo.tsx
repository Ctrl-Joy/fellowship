/** Fellowship brand images (cream on transparent), cut from design/fellowship-logo-source.png. */
const RING = '/brand/fellowship-ring.png'; // 480×318
const WORDMARK = '/brand/fellowship-wordmark.png'; // 640×158
const STACKED = '/brand/fellowship-logo.png'; // 720×622

/** The ring on its own. `height` in px; width follows the image's proportions. */
export function RingMark({ height = 24, className }: { height?: number; className?: string }) {
  return <img src={RING} alt="" aria-hidden="true" height={height} width={Math.round((height * 480) / 318)} className={className} style={{ display: 'block' }} />;
}

/** The FELLOWSHIP wordmark on its own. */
export function WordmarkImage({ height = 16, className }: { height?: number; className?: string }) {
  return <img src={WORDMARK} alt="Fellowship" height={height} width={Math.round((height * 640) / 158)} className={className} style={{ display: 'block' }} />;
}

/** Wordmark above the ring, for footers and other roomy spots. */
export function LogoStacked({ width = 160 }: { width?: number }) {
  return <img src={STACKED} alt="Fellowship" width={width} height={Math.round((width * 622) / 720)} style={{ display: 'block' }} />;
}

/** Square app mark: the ring, optionally on the dark rounded tile. */
export function LogoMark({ size = 32, framed = true }: { size?: number; framed?: boolean }) {
  return (
    <span role="img" aria-label="Fellowship" style={{
      width: size, height: size, borderRadius: framed ? size * 0.22 : 0, background: framed ? '#121212' : 'transparent',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
    }}>
      <RingMark height={Math.round(size * (framed ? 0.56 : 0.66))} />
    </span>
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="wordmark">
      <RingMark height={size} />
      <WordmarkImage height={Math.round(size * 0.62)} />
    </span>
  );
}

/** Ring beside the FELLOWSHIP wordmark, as in the landing header. */
export function BrandLockup({ className = '' }: { className?: string }) {
  return (
    <span className={`brand-lockup ${className}`.trim()}>
      <RingMark height={26} />
      <WordmarkImage height={17} />
    </span>
  );
}
