import { useEffect } from 'react';
import { useParams } from 'react-router';
import type { ProjectsViewProps } from './ProjectsRoot';
import { useItemPanel } from './ui';
import ItemDetail from './ItemDetail';
import './item.css';

/** /projects/item/:iid — the work item at full width. */
export default function ItemPage({ workspaceId, currentUser }: ProjectsViewProps) {
  const { iid = '' } = useParams();
  // The same item open in the drawer would just duplicate this page.
  useEffect(() => {
    const st = useItemPanel.getState();
    if (st.openItemId === iid) st.closeItem();
  }, [iid]);
  return (
    <div className="view pj-page pj-item-page">
      <ItemDetail key={iid} itemId={iid} workspaceId={workspaceId} currentUser={currentUser} mode="page" />
    </div>
  );
}
