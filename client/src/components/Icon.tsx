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
  home: 'M4 11 12 4l8 7M6 9.5V20h12V9.5M10 20v-5h4v5',
  messages: 'M4 5h12v9H8l-4 3zM8 17h8l4 3V9h-2',
  star: 'm12 4 2.5 5.2 5.5.8-4 3.9.9 5.6-4.9-2.6-4.9 2.6.9-5.6-4-3.9 5.5-.8z',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12l2-1.5-2-3.5-2.4.8a7 7 0 0 0-1.6-.9L14.5 4h-5L9 6.9a7 7 0 0 0-1.6.9L5 7l-2 3.5L5 12l-2 1.5L5 17l2.4-.8a7 7 0 0 0 1.6.9l.5 2.9h5l.5-2.9a7 7 0 0 0 1.6-.9L19 17l2-3.5z',
  filter: 'M4 6h16M7 12h10M10 18h4',
  bold: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z',
  italic: 'M10 5h8M6 19h8M14 5l-4 14',
  strike: 'M5 12h14M16 7a4 3 0 0 0-8 0c0 4 8 3 8 7a4 3 0 0 1-8 0',
  code: 'm9 8-4 4 4 4M15 8l4 4-4 4',
  codeBlock: 'M4 5h16v14H4zM9 10l-2 2 2 2M15 10l2 2-2 2',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  listOl: 'M10 6h10M10 12h10M10 18h10M4 5h1v3M4 11h2l-2 2h2M4 17h2v2H4',
  listUl: 'M10 6h10M10 12h10M10 18h10M5 6h.01M5 12h.01M5 18h.01',
  quote: 'M5 5v14M10 7h9M10 12h9M10 17h6',
  video: 'M4 7h11v10H4zM15 10l5-3v10l-5-3',
  mic: 'M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v3',
  slash: 'M5 4h14v16H5zM14 8l-4 8',
  type: 'M3 18 7.5 6 12 18M4.7 14h5.6M15 11.5a3 3 0 0 1 5 1.5V18M20 15.5c-1-1-5-1-5 1s4 2 5 0',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5v.7M12 17h.01',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  dots: 'M12 5h.01M12 12h.01M12 19h.01',
  grid: 'M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z',
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
