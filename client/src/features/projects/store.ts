import { create } from 'zustand';
import type { Project, WorkItem } from './types';

/**
 * Spaces and work items for the current workspace. Views read from here (filtered locally) so a
 * change made in one view, or arriving over WS, shows up everywhere at once.
 */
interface ProjectsState {
  workspaceId: string | null;
  loaded: boolean;
  projects: Record<string, Project>;
  items: Record<string, WorkItem>;
  /** Bumped whenever something changes that server-computed views (summary, development) depend on. */
  version: number;
  reset(wid: string): void;
  setProjects(wid: string, list: Project[]): void;
  upsertProject(p: Project): void;
  removeProject(id: string): void;
  upsertItems(list: WorkItem[]): void;
  removeItem(id: string): void;
}

export const useProjects = create<ProjectsState>()((set) => ({
  workspaceId: null,
  loaded: false,
  projects: {},
  items: {},
  version: 0,
  reset: (wid) => set({ workspaceId: wid, loaded: false, projects: {}, items: {}, version: 0 }),
  setProjects: (wid, list) => set((s) => (s.workspaceId && s.workspaceId !== wid ? s
    : { workspaceId: wid, loaded: true, projects: Object.fromEntries(list.map((p) => [p.id, p])) })),
  upsertProject: (p) => set((s) => {
    const next = { ...s.projects[p.id], ...p };
    if (s.projects[p.id] && JSON.stringify(s.projects[p.id]) === JSON.stringify(next)) return s;
    return { projects: { ...s.projects, [p.id]: next }, version: s.version + 1 };
  }),
  removeProject: (id) => set((s) => {
    const projects = { ...s.projects };
    delete projects[id];
    const items = Object.fromEntries(Object.entries(s.items).filter(([, i]) => i.projectId !== id));
    return { projects, items, version: s.version + 1 };
  }),
  upsertItems: (list) => set((s) => {
    // Only real changes bump `version`: views that refetch on `version` and store what they fetched
    // would otherwise loop forever.
    const changed = list.filter((i) => !sameItem(s.items[i.id], i));
    if (!changed.length) return s;
    const items = { ...s.items };
    for (const i of changed) items[i.id] = i;
    return { items, version: s.version + 1 };
  }),
  removeItem: (id) => set((s) => {
    const items = { ...s.items };
    // Children go with their parent.
    const doomed = [id];
    for (let k = 0; k < doomed.length; k++) for (const i of Object.values(items)) if (i.parentId === doomed[k]) doomed.push(i.id);
    for (const d of doomed) delete items[d];
    return { items, version: s.version + 1 };
  }),
}));

function sameItem(a: WorkItem | undefined, b: WorkItem) {
  if (!a) return false;
  for (const k of Object.keys(b) as (keyof WorkItem)[]) {
    const x = a[k], y = b[k];
    if (Array.isArray(x) && Array.isArray(y) ? x.join('\u0000') !== y.join('\u0000') : x !== y) return false;
  }
  return true;
}

/** Items of one space, ordered by rank. */
export function projectItems(items: Record<string, WorkItem>, projectId: string): WorkItem[] {
  return Object.values(items).filter((i) => i.projectId === projectId).sort((a, b) => a.rank - b.rank || a.number - b.number);
}
