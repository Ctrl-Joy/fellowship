import { create } from 'zustand';

export type PresenceState = 'active' | 'away';

interface PresenceStore {
  /** Presence of each workspace member by user id (missing = not known yet). */
  byUser: Record<string, PresenceState>;
  /** Whether the signed-in user has switched on "appear away". */
  manualAway: boolean;
  setAll(byUser: Record<string, PresenceState>): void;
  setOne(userId: string, state: PresenceState): void;
  setManualAway(on: boolean): void;
}

export const usePresence = create<PresenceStore>()((set) => ({
  byUser: {},
  manualAway: false,
  setAll: (byUser) => set({ byUser }),
  setOne: (userId, state) => set((s) => (s.byUser[userId] === state ? s : { byUser: { ...s.byUser, [userId]: state } })),
  setManualAway: (manualAway) => set({ manualAway }),
}));

export function presenceLabel(state: PresenceState | undefined): string {
  if (state === 'active') return 'Active';
  if (state === 'away') return 'Away';
  return 'Unknown';
}
