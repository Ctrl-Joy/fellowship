import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Conversation } from '../types';
import { api } from '../api';
import { useUi } from '../store/ui';
import { joinConversation, leaveConversation } from '../store/actions';
import { useConversations } from '../store/conversations';
import { Icon } from '../components/Icon';

export function ChannelBrowser({ workspaceId }: { workspaceId: string }) {
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [channels, setChannels] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const openModal = useUi((s) => s.openModal);
  const myConvs = useConversations((s) => s.byId);

  useEffect(() => {
    const t = setTimeout(() => {
      api.get<{ channels: Conversation[] }>(`/api/w/${workspaceId}/channels/browse?q=${encodeURIComponent(q)}${archived ? '&includeArchived=1' : ''}`)
        .then((r) => setChannels(r.channels)).catch((e) => setError(e.message));
    }, 150);
    return () => clearTimeout(t);
  }, [workspaceId, q, archived, Object.keys(myConvs).length]);

  return (
    <div className="view">
      <header className="view-head">
        <h2>Channels</h2>
        <button className="btn btn-primary" onClick={() => openModal({ kind: 'createChannel' })}><Icon name="plus" size={15} /> Create channel</button>
      </header>
      <div className="view-toolbar">
        <div className="searchbox searchbox-lg"><Icon name="search" size={16} /><input autoFocus placeholder="Search for channels" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label className="row gap-sm small"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Include archived</label>
      </div>
      <div className="view-scroll">
        {error && <div className="form-error">{error}</div>}
        {!channels && <div className="loading-block"><span className="spinner" /></div>}
        {channels && channels.length === 0 && <div className="empty">No channels match “{q}”.</div>}
        <ul className="browse-list">
          {channels?.map((c) => (
            <li key={c.id} className="browse-item" onClick={() => navigate(`/w/${workspaceId}/c/${c.id}`)}>
              <div className="browse-main">
                <div className="browse-name">
                  <Icon name={c.isPrivate ? 'lock' : 'hash'} size={15} /> {c.name}
                  {c.isArchived && <span className="tag">Archived</span>}
                </div>
                <div className="muted small">
                  {c.isMember && <span className="joined"><Icon name="check" size={12} /> Joined · </span>}
                  {c.memberCount} member{c.memberCount === 1 ? '' : 's'}{c.description ? ` · ${c.description}` : ''}
                </div>
              </div>
              <div className="browse-actions" onClick={(e) => e.stopPropagation()}>
                {c.isMember
                  ? !c.isDefault && <button className="btn btn-sm" onClick={async () => { await leaveConversation(c.id); setChannels((xs) => xs?.map((x) => x.id === c.id ? { ...x, isMember: false, memberCount: x.memberCount - 1 } : x) ?? null); }}>Leave</button>
                  : !c.isArchived && <button className="btn btn-sm btn-primary" onClick={async () => { await joinConversation(c.id); navigate(`/w/${workspaceId}/c/${c.id}`); }}>Join</button>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
