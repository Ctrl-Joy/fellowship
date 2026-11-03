import { usePresence, presenceLabel } from './store';
import './presence.css';

export interface PresenceDotProps {
  userId: string;
  size?: number;
  className?: string;
}

/** Green filled dot when active, hollow ring when away. Renders nothing until presence is known. */
export default function PresenceDot({ userId, size = 10, className = '' }: PresenceDotProps) {
  const state = usePresence((s) => s.byUser[userId]);
  if (!state) return null;
  const label = presenceLabel(state);
  return (
    <span
      className={`presence-dot presence-${state} ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}
