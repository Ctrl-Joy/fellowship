import type { User } from '../../types';

export interface HuddleWindowProps {
  workspaceId: string;
  currentUser: User;
}

/** Floating active-huddle window, always mounted in the shell. Core stub — owned by `huddles`. */
export default function HuddleWindow(_props: HuddleWindowProps) {
  return null;
}
