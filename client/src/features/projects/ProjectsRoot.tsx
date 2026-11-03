import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import type { User } from '../../types';
import ProjectPage from './ProjectPage';
import ForYou from './ForYou';
import AllSpaces from './AllSpaces';
import FiltersPage from './FiltersPage';
import DashboardsPage from './DashboardsPage';
import FormSubmitPage from './FormSubmitPage';
import ItemPage from './ItemPage';
import ItemPanel from './ItemPanel';
import CreateItemModal from './CreateItemModal';
import { useItemPanel } from './ui';
import './projects.css';

export interface ProjectsViewProps { workspaceId: string; currentUser: User }

/** Everything under /w/:wid/projects. */
export default function ProjectsRoot({ workspaceId, currentUser }: ProjectsViewProps) {
  const props = { workspaceId, currentUser };
  const { pathname } = useLocation();
  // The side panel belongs to the page it was opened from; moving to another page closes it.
  useEffect(() => { useItemPanel.getState().closeItem(); }, [pathname]);
  return (
    <>
      <Routes>
        <Route index element={<ForYou {...props} />} />
        <Route path="all" element={<AllSpaces {...props} />} />
        <Route path="filters" element={<FiltersPage {...props} />} />
        <Route path="dashboards" element={<DashboardsPage {...props} />} />
        <Route path="dashboards/:did" element={<DashboardsPage {...props} />} />
        <Route path="form/:fid" element={<FormSubmitPage {...props} />} />
        <Route path="item/:iid" element={<ItemPage {...props} />} />
        <Route path="p/:pid" element={<ProjectPage {...props} />} />
        <Route path="p/:pid/:tab" element={<ProjectPage {...props} />} />
        <Route path="*" element={<Navigate to={`/w/${workspaceId}/projects`} replace />} />
      </Routes>
      <ItemPanel {...props} />
      <CreateItemModal {...props} />
    </>
  );
}
