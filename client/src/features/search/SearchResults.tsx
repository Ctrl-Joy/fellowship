import type { User } from '../../types';

export interface SearchResultsProps {
  workspaceId: string;
  query: string;
  currentUser: User;
}

/** Full search results view at /w/:wid/search?q=. Core stub — owned by `search`. */
export default function SearchResults({ query }: SearchResultsProps) {
  return (
    <div className="view">
      <header className="view-head"><h2>Search</h2><span className="muted">“{query}”</span></header>
      <div className="empty">Search is coming soon.</div>
    </div>
  );
}
