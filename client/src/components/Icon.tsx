import type { SVGProps } from 'react';

/** Small original line-icon set (24×24, stroke = currentColor). */
const PATHS: Record<string, string> = {
  hash: 'M5 9h14M5 15h14M10 4 8 20M16 4l-2 16',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  plus: 'M12 5v14M5 12h14',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  thread: 'M4 5h16v10H9l-5 4z',
  at: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zm0 0v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-4 7.5',
  bookmark: 'M6 4h12v16l-6-4-6 4z',
  pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v7',
  smile: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  send: 'M4 12 20 4l-6 16-3-7z',
  clip: 'M20 11.5 12 19.5a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  x: 'M6 6l12 12M18 6 6 18',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 7',
  apps: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  workflow: 'M5 4h5v5H5zM14 15h5v5h-5zM7.5 9v4a2 2 0 0 0 2 2H14',
  headphones: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H4zM17 15h3v5h-3z',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
  back: 'M15 6l-6 6 6 6',
  forward: 'M9 6l6 6-6 6',
  compose: 'M4 20h4L20 8l-4-4L4 16zM13 7l4 4',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  canvas: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
  check: 'm5 12 5 5 9-10',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  archive: 'M4 5h16v4H4zM6 9v10h12V9M10 13h4',
  reply: 'M10 8 5 12l5 4M5 12h9a5 5 0 0 1 5 5v1',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, ...rest }: { name: IconName | string; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={PATHS[name] ?? PATHS.info} />
    </svg>
  );
}
