import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Icon } from '../../components/Icon';

export interface SearchBoxProps {
  workspaceId: string;
  workspaceName: string;
}

/** Top-bar search box. Core stub: Enter navigates to /w/:wid/search?q=… — owned by `search`. */
export default function SearchBox({ workspaceId, workspaceName }: SearchBoxProps) {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const navigate = useNavigate();
  return (
    <form className="searchbox" onSubmit={(e) => {
      e.preventDefault();
      if (q.trim()) navigate(`/w/${workspaceId}/search?q=${encodeURIComponent(q.trim())}`);
    }}>
      <Icon name="search" size={16} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${workspaceName}`} aria-label="Search" />
    </form>
  );
}
