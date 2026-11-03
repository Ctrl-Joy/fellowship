import type { FeatureSetup } from '../types';
import { ws } from '../../ws';
import { useProjects } from './store';
import { projectsApi } from './api';
import type { Project, WorkItem } from './types';
import { showToast } from './toast';

/** Load spaces for the workspace and apply project/item events live. */
const setup: FeatureSetup = ({ workspaceId, me }) => {
  const st = () => useProjects.getState();
  st().reset(workspaceId);
  projectsApi.listProjects(workspaceId).catch(() => {});
  const mine = (frame: any) => !frame?.workspaceId || frame.workspaceId === workspaceId;

  const offs = [
    ws.on('project.created', (p: { project: Project }, f) => {
      // Broadcast copies carry no per-viewer fields; keep ours.
      if (mine(f)) { const cur = st().projects[p.project.id]; st().upsertProject({ ...p.project, starred: cur?.starred ?? false, visitedAt: cur?.visitedAt ?? null }); }
    }),
    ws.on('project.updated', (p: { project: Project }, f) => {
      if (mine(f)) { const cur = st().projects[p.project.id]; st().upsertProject({ ...p.project, starred: cur?.starred ?? false, visitedAt: cur?.visitedAt ?? null }); }
    }),
    ws.on('project.deleted', (p: { projectId: string }, f) => { if (mine(f)) st().removeProject(p.projectId); }),
    ws.on('project.dev_updated', (_p, f) => { if (mine(f)) useProjects.setState((s) => ({ version: s.version + 1 })); }),
    ws.on('item.created', (p: { item: WorkItem }, f) => { if (mine(f)) st().upsertItems([p.item]); }),
    ws.on('item.updated', (p: { item: WorkItem }, f) => { if (mine(f)) st().upsertItems([p.item]); }),
    ws.on('item.deleted', (p: { itemId: string }, f) => { if (mine(f)) st().removeItem(p.itemId); }),
    ws.on('item.commented', (_p, f) => { if (mine(f)) useProjects.setState((s) => ({ version: s.version + 1 })); }),
    ws.on('item.assigned', (p: { item: WorkItem; by: string }) => {
      st().upsertItems([p.item]);
      if (p.by !== me.id) showToast(`${p.item.key} was assigned to you: ${p.item.summary}`, `/w/${workspaceId}/projects/item/${p.item.id}`);
    }),
    ws.on('hello', () => { projectsApi.listProjects(workspaceId).catch(() => {}); }),
  ];
  return () => offs.forEach((off) => off());
};

export default setup;
