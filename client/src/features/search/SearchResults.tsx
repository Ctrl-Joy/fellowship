import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { Message, User } from '../../types';
import { api, ApiError } from '../../api';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { useSession, displayName } from '../../store/session';
import { useUi } from '../../store/ui';
import { formatFull } from '../../lib/time';
import { formatBytes } from '../files/useUpload';
import { kindOf, FileCard, type FileDto } from '../files/Attachments';
import '../files/files.css';
import './search.css';

export interface SearchResultsProps {
  workspaceId: string;
  query: string;
  currentUser: User;
}

type SearchType = 'messages' | 'files' | 'channels' | 'people';
const TYPES: { id: SearchType; label: string }[] = [
  { id: 'messages', label: 'Messages' },
  { id: 'files', label: 'Files' },
  { id: 'channels', label: 'Channels' },
  { id: 'people', label: 'People' },
];

interface ConvRef { id: string; name: string | null; kind: string; isPrivate: boolean }
interface ChannelDto { id: string; name: string; topic: string; description: string; isPrivate: boolean; isArchived: boolean; memberCount: number; isMember: boolean }
interface PersonDto { id: string; fullName: string; displayName: string; title: string; avatarUrl: string | null; isBot: boolean }

type Result =
  | { type: 'message'; message: Message; snippet: string; conversation: ConvRef }
  | { type: 'file'; file: FileDto; conversation: ConvRef; messageId: string | null }
  | { type: 'channel'; conversation: ChannelDto }
  | { type: 'person'; user: PersonDto };

interface Parsed {
  terms: string[];
  in: string | null;
  from: string | null;
  has: string[];
  is: string | null;
  before: number | null;
  after: number | null;
}

interface Page {
  query: string;
  type: SearchType;
  parsed: Parsed;
  results: Result[];
  nextCursor: string | null;
}

const MARK_RE = /\u0002([^\u0003]*)\u0003/g;

/** Turn the server snippet (text with \u0002match\u0003 markers) into React nodes. Never HTML. */
export function renderSnippet(raw: string): ReactNode[] {
  // Drop *bold* _italic_ ~strike~ `code` markers; the match markers count as word edges.
  const text = raw
    .replace(/(^|[\s(\u0002])[*_~`]+(?=[^\s*_~`])/g, '$1')
    .replace(/([^\s*_~`])[*_~`]+(?=[\s.,;:!?)\u0003]|$)/g, '$1');
  const out: ReactNode[] = [];
  const re = new RegExp(MARK_RE.source, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(plain(text.slice(last, m.index), `t${last}`));
    out.push(<mark key={`m${m.index}`}>{plain(m[1], `x${m.index}`)}</mark>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(plain(text.slice(last), `e${last}`));
  return out;
}

function plain(s: string, key: string) {
  return <span key={key}>{s.replace(/[\u0002\u0003]/g, '')}</span>;
}

function ConvTag({ conv }: { conv: ConvRef | undefined }) {
  if (!conv) return <span className="srch-conv">Unknown conversation</span>;
  if (conv.kind === 'channel') {
    return <span className="srch-conv"><Icon name={conv.isPrivate ? 'lock' : 'hash'} size={12} /> {conv.name}</span>;
  }
  if (conv.kind === 'self') return <span className="srch-conv"><Icon name="lock" size={12} /> Notes to self</span>;
  return <span className="srch-conv"><Icon name="at" size={12} /> Direct message</span>;
}

export default function SearchResults({ workspaceId, query, currentUser }: SearchResultsProps) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const members = useSession((s) => s.members);
  const openPanel = useUi((s) => s.openRightPanel);
  const rawType = params.get('type');
  const type: SearchType = TYPES.some((t) => t.id === rawType) ? (rawType as SearchType) : 'messages';

  const [page, setPage] = useState<Page | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const fetchPage = useCallback((cursor?: string) => {
    const my = ++seq.current;
    const qs = new URLSearchParams({ q: query, type });
    if (cursor) qs.set('cursor', cursor);
    setLoading(true);
    return api.get<Page>(`/api/w/${workspaceId}/search?${qs.toString()}`)
      .then((p) => {
        if (my !== seq.current) return;
        setPage(p);
        setResults((prev) => (cursor ? [...prev, ...p.results] : p.results));
        setError(null);
      })
      .catch((e: unknown) => {
        if (my !== seq.current) return;
        setError(e instanceof ApiError ? e.message : 'Search failed. Try again.');
      })
      .finally(() => { if (my === seq.current) setLoading(false); });
  }, [workspaceId, query, type]);

  useEffect(() => {
    setResults([]);
    setPage(null);
    setError(null);
    if (!query.trim()) { setLoading(false); return; }
    fetchPage();
  }, [fetchPage, query]);

  function setType(t: SearchType) {
    const next = new URLSearchParams(params);
    next.set('type', t);
    setParams(next, { replace: true });
  }

  /** Message results open the channel at that message, or the thread when the message is a reply. */
  function jumpToMessage(m: Message) {
    const cid = m.conversationId;
    if (m.threadRootId) {
      navigate(`/w/${workspaceId}/c/${cid}`);
      openPanel({ kind: 'thread', conversationId: cid, rootId: m.threadRootId });
    } else {
      navigate(`/w/${workspaceId}/c/${cid}?m=${m.id}`);
    }
  }

  const parsed = page?.parsed;
  const chips: string[] = parsed ? [
    ...parsed.terms.map((t) => `“${t}”`),
    ...(parsed.in ? [`in:#${parsed.in}`] : []),
    ...(parsed.from ? [`from:@${parsed.from}`] : []),
    ...parsed.has.map((h) => `has:${h}`),
    ...(parsed.is ? [`is:${parsed.is}`] : []),
    ...(parsed.after != null ? [`after ${new Date(parsed.after - 86400000).toISOString().slice(0, 10)}`] : []),
    ...(parsed.before != null ? [`before ${new Date(parsed.before).toISOString().slice(0, 10)}`] : []),
  ] : [];
  const hasQuery = query.trim().length > 0;
  const resultType: Result['type'] = type === 'messages' ? 'message' : type === 'files' ? 'file' : type === 'channels' ? 'channel' : 'person';
  const shown = results.filter((r) => r.type === resultType);

  return (
    <div className="srch-page">
      <header className="view-head">
        <h2>Search</h2>
        {hasQuery && <span className="muted">“{query}”</span>}
      </header>
      <nav className="srch-tabs" role="tablist" aria-label="Result types">
        {TYPES.map((t) => (
          <button key={t.id} role="tab" aria-selected={type === t.id}
            className={`srch-tab${type === t.id ? ' active' : ''}`} onClick={() => setType(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="srch-body">
        {!hasQuery && (
          <div className="srch-status">
            <h3>Search this workspace</h3>
            <p>Try <code>roadmap</code>, <code>&quot;exact phrase&quot;</code> or <code>in:#general from:@ava has:link</code>.</p>
          </div>
        )}
        {hasQuery && chips.length > 0 && (
          <div className="srch-chips" aria-label="Search terms">
            {chips.map((c) => <span key={c} className="srch-chip">{c}</span>)}
          </div>
        )}
        {error && <div className="srch-status"><p>{error}</p></div>}
        {hasQuery && !error && page && shown.length > 0 && (
          <div className="srch-summary">{shown.length}{page.nextCursor ? '+' : ''} {type} found</div>
        )}

        {type === 'messages' && (
          <div className="srch-list">
            {shown.map((r, i) => r.type === 'message' && (
              <button key={`${r.message.id}-${i}`} className="srch-card" onClick={() => jumpToMessage(r.message)}>
                <Avatar userId={r.message.userId} size={32} />
                <div className="srch-card-main">
                  <div className="srch-card-meta">
                    <strong>{members[r.message.userId] ? displayName(members[r.message.userId]) : 'Someone'}</strong>
                    <ConvTag conv={r.conversation} />
                    {r.message.threadRootId && <span>thread reply</span>}
                    <time title={formatFull(r.message.createdAt)}>{formatFull(r.message.createdAt)}</time>
                  </div>
                  <div className="srch-snippet">{renderSnippet(r.snippet)}</div>
                </div>
                <span className="srch-go">Jump</span>
              </button>
            ))}
          </div>
        )}

        {type === 'files' && (
          <div className="srch-list">
            {shown.map((r, i) => r.type === 'file' && (
              <div key={`${r.file.id}-${i}`} className="files-row">
                {kindOf(r.file) === 'image' ? (
                  <>
                    <img className="files-thumb" src={r.file.thumbUrl ?? r.file.url} alt="" loading="lazy" />
                    <div className="files-row-body">
                      <a className="att-name" href={r.file.url} target="_blank" rel="noreferrer">{r.file.name}</a>
                      <div className="files-row-meta">{formatBytes(r.file.size)}</div>
                    </div>
                  </>
                ) : (
                  <div className="files-row-body"><FileCard file={r.file} /></div>
                )}
                <div className="files-row-meta" style={{ minWidth: 150, textAlign: 'right' }}>
                  <ConvTag conv={r.conversation} /><br />{formatFull(r.file.createdAt)}
                </div>
                <div className="files-row-actions">
                  <button className="files-btn" disabled={!r.messageId}
                    onClick={() => navigate(`/w/${workspaceId}/c/${r.conversation.id}${r.messageId ? `?m=${r.messageId}` : ''}`)}>
                    Open message
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {type === 'channels' && (
          <div className="srch-list">
            {shown.map((r, i) => r.type === 'channel' && (
              <button key={`${r.conversation.id}-${i}`} className="srch-card"
                onClick={() => navigate(`/w/${workspaceId}/c/${r.conversation.id}`)}>
                <span className="srch-icon" aria-hidden="true"><Icon name={r.conversation.isPrivate ? 'lock' : 'hash'} size={18} /></span>
                <div className="srch-card-main">
                  <div className="srch-card-meta">
                    <strong>{r.conversation.name}</strong>
                    <span>{r.conversation.memberCount} member{r.conversation.memberCount === 1 ? '' : 's'}</span>
                    {r.conversation.isArchived && <span>archived</span>}
                    {!r.conversation.isMember && <span>not joined</span>}
                  </div>
                  {(r.conversation.topic || r.conversation.description) && (
                    <div className="srch-card-sub">{r.conversation.topic || r.conversation.description}</div>
                  )}
                </div>
                <span className="srch-go">Open</span>
              </button>
            ))}
          </div>
        )}

        {type === 'people' && (
          <div className="srch-list">
            {shown.map((r, i) => r.type === 'person' && (
              <button key={`${r.user.id}-${i}`} className="srch-card" onClick={() => openPanel({ kind: 'profile', userId: r.user.id })}>
                <Avatar user={{ id: r.user.id, fullName: r.user.fullName, displayName: r.user.displayName, avatarUrl: r.user.avatarUrl }} size={36} />
                <div className="srch-card-main">
                  <div className="srch-card-meta">
                    <strong>{r.user.displayName}</strong>
                    {r.user.isBot && <span>app</span>}
                    {r.user.id === currentUser.id && <span>you</span>}
                  </div>
                  {(r.user.title || r.user.fullName !== r.user.displayName) && (
                    <div className="srch-card-sub">
                      {r.user.fullName !== r.user.displayName ? r.user.fullName : ''}
                      {r.user.title ? `${r.user.fullName !== r.user.displayName ? ' · ' : ''}${r.user.title}` : ''}
                    </div>
                  )}
                </div>
                <span className="srch-go">Profile</span>
              </button>
            ))}
          </div>
        )}

        {hasQuery && !loading && !error && page && shown.length === 0 && (
          <div className="srch-status">
            <h3>No {type} found</h3>
            <p>Nothing you can read matches “{query}”. Private channels and DMs only show results to their members.</p>
          </div>
        )}
        {loading && <div className="loading-block"><span className="spinner" /> Searching…</div>}
        {!loading && page?.nextCursor && (
          <button className="srch-btn srch-more" onClick={() => fetchPage(page.nextCursor!)}>Load more</button>
        )}
      </div>
    </div>
  );
}
