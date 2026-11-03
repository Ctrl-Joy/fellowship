import { Link, useNavigate } from 'react-router';
import { useSession } from '../store/session';
import { LogoMark } from '../components/Logo';
import { Icon } from '../components/Icon';
import { initials } from '../components/Avatar';

export function WorkspaceRail() {
  const workspaces = useSession((s) => s.workspaces);
  const current = useSession((s) => s.workspaceId);
  const navigate = useNavigate();
  return (
    <nav className="rail" aria-label="Workspaces">
      <Link to="/workspaces" className="rail-logo" title="Fellowship"><LogoMark size={30} /></Link>
      <div className="rail-list">
        {workspaces.map((w) => (
          <button key={w.id} className={`rail-ws${w.id === current ? ' active' : ''}`} title={w.name}
            onClick={() => navigate(`/w/${w.id}`)}>
            {w.iconUrl ? <img src={w.iconUrl} alt="" /> : initials(w.name)}
          </button>
        ))}
        <button className="rail-add" title="Add a workspace" onClick={() => navigate('/workspaces')}><Icon name="plus" /></button>
      </div>
    </nav>
  );
}
