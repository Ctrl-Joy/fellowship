/** Huddle-specific line icons (same 24px stroke style as components/Icon). */
const PATHS = {
  headphones: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H4zM17 15h3v5h-3z',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21',
  micOff: 'M15 10V6a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 4.6 2.5M5.5 11a6.5 6.5 0 0 0 10.4 5.2M18.5 11a6.4 6.4 0 0 1-.6 2.7M12 17.5V21M4 4l16 16',
  video: 'M3 7h12v10H3zM15 10.5 21 7v10l-6-3.5',
  videoOff: 'M3 7h3m4 0h5v5M15 10.5 21 7v10l-4.5-2.6M3 7v10h12v-1M3 3l18 18',
  screen: 'M3 4h18v12H3zM8 20h8M12 16v4M12 13V7M9 10l3-3 3 3',
  screenOff: 'M3 4h18v12H3zM8 20h8M12 16v4M9 7l6 6M15 7l-6 6',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 1.2 14H1a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.6 7a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 1.2V1a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  leave: 'M4 14.5c4.5-4.6 11.5-4.6 16 0l-2 2.5-3-1.2v-2.3a9 9 0 0 0-6 0v2.3L6 17z',
  thread: 'M4 5h16v10H9l-5 4z',
  dock: 'M4 4h16v16H4zM4 15h16',
  undock: 'M4 4h16v16H4zM12 8h5v5',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  collapse: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  x: 'M6 6l12 12M18 6 6 18',
} as const;

export type HuddleIconName = keyof typeof PATHS;

export function HIcon({ name, size = 18, className = '' }: { name: HuddleIconName; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
