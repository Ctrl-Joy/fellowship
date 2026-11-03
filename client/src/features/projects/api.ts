import { api } from '../../api';
import type {
  Activity, Comment, Dashboard, DevData, FormTemplate, ItemQuery, Project, ProjectForm, SavedFilter, Summary, WorkItem,
} from './types';
import { useProjects } from './store';

const qs = (q: Record<string, string | string[] | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    p.set(k, Array.isArray(v) ? v.join(',') : v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** Every call that changes data also updates the store, so all views stay in sync without refetching. */
export const projectsApi = {
  async listProjects(wid: string) {
    const r = await api.get<{ projects: Project[] }>(`/api/w/${wid}/projects`);
    useProjects.getState().setProjects(wid, r.projects);
    return r.projects;
  },
  async createProject(wid: string, body: { name: string; key?: string; iconEmoji?: string; color?: string; description?: string }) {
    const r = await api.post<{ project: Project }>(`/api/w/${wid}/projects`, body);
    useProjects.getState().upsertProject(r.project);
    return r.project;
  },
  async createSample(wid: string) {
    const r = await api.post<{ project: Project }>(`/api/w/${wid}/projects/sample`, {});
    useProjects.getState().upsertProject(r.project);
    return r.project;
  },
  async getProject(pid: string) {
    const r = await api.get<{ project: Project }>(`/api/projects/${pid}`);
    useProjects.getState().upsertProject(r.project);
    return r.project;
  },
  async updateProject(pid: string, body: Partial<Pick<Project, 'name' | 'iconEmoji' | 'color' | 'description' | 'leadId'>> & { tabs?: Partial<Project['tabs']> }) {
    const r = await api.patch<{ project: Project }>(`/api/projects/${pid}`, body);
    useProjects.getState().upsertProject(r.project);
    return r.project;
  },
  async deleteProject(pid: string) {
    await api.del(`/api/projects/${pid}`);
    useProjects.getState().removeProject(pid);
  },
  async toggleStar(pid: string) {
    const r = await api.post<{ project: Project }>(`/api/projects/${pid}/star`, {});
    useProjects.getState().upsertProject(r.project);
    return r.project;
  },
  visit: (pid: string) => api.post(`/api/projects/${pid}/visit`, {}).catch(() => {}),

  async listItems(pid: string, q: { q?: string; ask?: string; assignee?: string[]; status?: string[]; type?: string[]; priority?: string[]; parent?: string } = {}) {
    const r = await api.get<{ items: WorkItem[]; total: number; explanation: string[] }>(`/api/projects/${pid}/items${qs(q)}`);
    useProjects.getState().upsertItems(r.items);
    return r;
  },
  async searchItems(wid: string, q: ItemQuery) {
    const { text, ...rest } = q;
    const r = await api.get<{ items: WorkItem[]; explanation: string[] }>(`/api/w/${wid}/items${qs({ ...rest, q: text })}`);
    useProjects.getState().upsertItems(r.items);
    return r;
  },
  async getItem(iid: string) {
    const r = await api.get<{ item: WorkItem; children: WorkItem[] }>(`/api/items/${iid}`);
    useProjects.getState().upsertItems([r.item, ...r.children]);
    return r;
  },
  async getItemByKey(wid: string, key: string) {
    const r = await api.get<{ item: WorkItem }>(`/api/w/${wid}/items/by-key/${encodeURIComponent(key)}`);
    useProjects.getState().upsertItems([r.item]);
    return r.item;
  },
  async createItem(pid: string, body: Partial<WorkItem> & { summary: string }) {
    const r = await api.post<{ item: WorkItem }>(`/api/projects/${pid}/items`, body);
    useProjects.getState().upsertItems([r.item]);
    return r.item;
  },
  async updateItem(iid: string, body: Partial<Pick<WorkItem, 'type' | 'summary' | 'description' | 'status' | 'priority' | 'assigneeId' | 'reporterId' | 'parentId' | 'startDate' | 'dueDate' | 'labels'>>) {
    // Optimistic: apply locally first, then reconcile with the server's copy.
    const st = useProjects.getState();
    const before = st.items[iid];
    if (before) st.upsertItems([{ ...before, ...body }]);
    try {
      const r = await api.patch<{ item: WorkItem }>(`/api/items/${iid}`, body);
      useProjects.getState().upsertItems([r.item]);
      return r.item;
    } catch (e) {
      if (before) useProjects.getState().upsertItems([before]);
      throw e;
    }
  },
  /** Move an item: `afterId` = item above it, `beforeId` = item below it; optional new status (board columns). */
  async rankItem(iid: string, body: { afterId?: string | null; beforeId?: string | null; status?: WorkItem['status'] }) {
    const st = useProjects.getState();
    const before = st.items[iid];
    if (before) {
      const rankOf = (id?: string | null) => (id ? st.items[id]?.rank : undefined);
      const a = rankOf(body.afterId), b = rankOf(body.beforeId);
      const rank = a != null && b != null ? (a + b) / 2 : a != null ? a + 1 : b != null ? b - 1 : before.rank;
      st.upsertItems([{ ...before, rank, status: body.status ?? before.status }]);
    }
    try {
      const r = await api.post<{ item: WorkItem }>(`/api/items/${iid}/rank`, body);
      useProjects.getState().upsertItems([r.item]);
      return r.item;
    } catch (e) {
      if (before) useProjects.getState().upsertItems([before]);
      throw e;
    }
  },
  async deleteItem(iid: string) {
    await api.del(`/api/items/${iid}`);
    useProjects.getState().removeItem(iid);
  },
  activity: (iid: string) => api.get<{ activity: Activity[] }>(`/api/items/${iid}/activity`).then((r) => r.activity),
  comments: (iid: string) => api.get<{ comments: Comment[] }>(`/api/items/${iid}/comments`).then((r) => r.comments),
  addComment: (iid: string, text: string) => api.post<{ comment: Comment }>(`/api/items/${iid}/comments`, { text }).then((r) => r.comment),
  share: (iid: string, conversationId: string, comment?: string) => api.post(`/api/items/${iid}/share`, { conversationId, comment }),

  summary: (pid: string, opts: { days?: number; assignee?: string[] } = {}) =>
    api.get<Summary>(`/api/projects/${pid}/summary${qs({ days: opts.days ? String(opts.days) : undefined, assignee: opts.assignee })}`),
  development: (pid: string) => api.get<DevData>(`/api/projects/${pid}/development`),

  forms: (pid: string) => api.get<{ forms: ProjectForm[]; templates: FormTemplate[] }>(`/api/projects/${pid}/forms`),
  getForm: (fid: string) => api.get<{ form: ProjectForm; project: Project }>(`/api/forms/${fid}`),
  createForm: (pid: string, body: { name: string; template?: string; description?: string; itemType?: string; fields?: ProjectForm['fields'] }) =>
    api.post<{ form: ProjectForm }>(`/api/projects/${pid}/forms`, body).then((r) => r.form),
  updateForm: (fid: string, body: Partial<Pick<ProjectForm, 'name' | 'description' | 'itemType' | 'fields' | 'active'>>) =>
    api.patch<{ form: ProjectForm }>(`/api/forms/${fid}`, body).then((r) => r.form),
  deleteForm: (fid: string) => api.del(`/api/forms/${fid}`),
  submitForm: async (fid: string, values: Record<string, string>) => {
    const r = await api.post<{ item: WorkItem }>(`/api/forms/${fid}/submit`, { values });
    useProjects.getState().upsertItems([r.item]);
    return r.item;
  },

  filters: (wid: string) => api.get<{ filters: SavedFilter[] }>(`/api/w/${wid}/project-filters`).then((r) => r.filters),
  saveFilter: (wid: string, name: string, query: ItemQuery) => api.post<{ filter: SavedFilter }>(`/api/w/${wid}/project-filters`, { name, query }).then((r) => r.filter),
  deleteFilter: (id: string) => api.del(`/api/project-filters/${id}`),

  dashboards: (wid: string) => api.get<{ dashboards: Dashboard[] }>(`/api/w/${wid}/dashboards`).then((r) => r.dashboards),
  createDashboard: (wid: string, name: string, widgets: Dashboard['widgets'] = []) => api.post<{ dashboard: Dashboard }>(`/api/w/${wid}/dashboards`, { name, widgets }).then((r) => r.dashboard),
  updateDashboard: (id: string, body: { name?: string; widgets?: Dashboard['widgets'] }) => api.patch<{ dashboard: Dashboard }>(`/api/dashboards/${id}`, body).then((r) => r.dashboard),
  deleteDashboard: (id: string) => api.del(`/api/dashboards/${id}`),

  forYou: async (wid: string) => {
    const r = await api.get<{ assigned: WorkItem[]; recentItems: WorkItem[]; recentSpaces: Project[] }>(`/api/w/${wid}/for-you`);
    useProjects.getState().upsertItems([...r.assigned, ...r.recentItems]);
    return r;
  },
};
