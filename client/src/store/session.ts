import { create } from 'zustand';
import type { Member, User, Workspace } from '../types';

interface SessionState {
  /** Signed-in user (null when signed out). */
  me: User | null;
  /** true once the initial /api/auth/me check finished. */
  loaded: boolean;
  workspaces: Workspace[];
  /** Current workspace id (set by the /w/:wid route). */
  workspaceId: string | null;
  /** Members of the current workspace by user id. */
  members: Record<string, Member>;
  membersLoaded: boolean;
  setMe(me: User | null): void;
  setWorkspaces(list: Workspace[]): void;
  upsertWorkspace(w: Workspace): void;
  setWorkspaceId(id: string | null): void;
  setMembers(list: Member[]): void;
  /** Merge a (partial) member/user into the members map (and `me` if it is you). */
  upsertMember(m: Partial<Member> & { id: string }): void;
}

export const useSession = create<SessionState>()((set) => ({
  me: null,
  loaded: false,
  workspaces: [],
  workspaceId: null,
  members: {},
  membersLoaded: false,
  setMe: (me) => set({ me, loaded: true }),
  setWorkspaces: (workspaces) => set({ workspaces }),
  upsertWorkspace: (w) => set((s) => {
    const i = s.workspaces.findIndex((x) => x.id === w.id);
    if (i === -1) return { workspaces: [...s.workspaces, w] };
    const next = s.workspaces.slice();
    next[i] = { ...next[i], ...w, role: w.role ?? next[i].role };
    return { workspaces: next };
  }),
  setWorkspaceId: (workspaceId) => set((s) => (s.workspaceId === workspaceId ? s : { workspaceId, members: {}, membersLoaded: false })),
  setMembers: (list) => set({ members: Object.fromEntries(list.map((m) => [m.id, m])), membersLoaded: true }),
  upsertMember: (m) => set((s) => {
    const prev = s.members[m.id];
    const merged = { ...(prev ?? { role: 'member', joinedAt: Date.now(), deactivated: false }), ...m } as Member;
    if (prev && m.role == null) merged.role = prev.role;
    const out: Partial<SessionState> = { members: { ...s.members, [m.id]: merged } };
    if (s.me && s.me.id === m.id) out.me = { ...s.me, ...stripMember(m) };
    return out;
  }),
}));

function stripMember(m: Partial<Member>): Partial<User> {
  const { role: _r, joinedAt: _j, deactivated: _d, ...user } = m;
  return user;
}

/** Current user; throws if used outside the signed-in shell. */
export function useMe(): User {
  const me = useSession((s) => s.me);
  if (!me) throw new Error('useMe() used while signed out');
  return me;
}

export function useMember(userId: string | null | undefined): Member | undefined {
  return useSession((s) => (userId ? s.members[userId] : undefined));
}

export function displayName(u: Pick<User, 'displayName' | 'fullName'> | undefined | null): string {
  if (!u) return 'Unknown';
  return u.displayName || u.fullName || 'Unknown';
}
