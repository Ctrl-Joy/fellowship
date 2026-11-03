import { Fragment, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useSession } from '../store/session';
import { useConversations } from '../store/conversations';
import { useUi } from '../store/ui';
import { emojiForShortcode } from '../features/reactions/shortcodes';

/**
 * Minimal, safe markdown for messages (no HTML injection — builds React nodes):
 *   *bold*  **bold**  _italic_  ~strike~  `code`  ```code block```  > quote  links
 *   plus mention tokens <@U…>, <#C…>, <!channel|here|everyone>.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="md">{renderBlocks(text)}</div>;
}

function renderBlocks(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(/```/);
  parts.forEach((part, i) => {
    if (i % 2 === 1 && i < parts.length - 1) {
      out.push(<pre key={`pre${i}`} className="md-pre"><code>{part.replace(/^\n/, '').replace(/\n$/, '')}</code></pre>);
      return;
    }
    const chunk = i % 2 === 1 ? '```' + part : part; // unterminated fence → literal
    out.push(...renderLines(i > 0 ? chunk.replace(/^\n/, '') : chunk, `b${i}`));
  });
  return out;
}

function renderLines(text: string, keyBase: string): ReactNode[] {
  if (!text) return [];
  const lines = text.split('\n');
  const out: ReactNode[] = [];
  let quote: string[] = [];
  let para: string[] = [];
  let k = 0;
  const flushPara = () => {
    if (!para.length) return;
    const p = para;
    out.push(
      <p key={`${keyBase}p${k++}`} className="md-p">
        {p.map((line, i) => <Fragment key={i}>{i > 0 && <br />}{renderInline(line)}</Fragment>)}
      </p>,
    );
    para = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    const q = quote;
    out.push(
      <blockquote key={`${keyBase}q${k++}`} className="md-quote">
        {q.map((line, i) => <Fragment key={i}>{i > 0 && <br />}{renderInline(line)}</Fragment>)}
      </blockquote>,
    );
    quote = [];
  };
  for (const line of lines) {
    const m = /^(>|&gt;)\s?(.*)$/.exec(line);
    if (m) { flushPara(); quote.push(m[2]); }
    else { flushQuote(); para.push(line); }
  }
  flushPara();
  flushQuote();
  return out;
}

const INLINE = new RegExp(
  [
    '(`[^`\\n]+`)', // 1 code
    '(<@([A-Z0-9]+)>)', // 2,3 user mention
    '(<#([A-Z0-9]+)>)', // 4,5 channel link
    '(<!(channel|here|everyone)>)', // 6,7 broadcast
    '(<(https?:\\/\\/[^|>\\s]+)\\|([^>]+)>)', // 8,9,10 labelled link
    "(https?:\\/\\/[^\\s<>]*[^\\s<>.,;:!?)\\]'\"])", // 11 bare link
    '(\\*\\*([^*\\n]+)\\*\\*)', // 12,13 bold
    '((?<![\\w*])\\*([^*\\n]+)\\*(?![\\w*]))', // 14,15 bold
    '((?<![\\w\\\\])_([^_\\n]+)_(?![\\w/]))', // 16,17 italic (not \_ escapes, so ¯\_(ツ)_/¯ survives)
    '((?<![\\w~])~([^~\\n]+)~(?![\\w~]))', // 18,19 strike
    '(:([a-z][a-z0-9_+-]{1,40}):)', // 20,21 :emoji shortcode: (reactions module)
  ].join('|'),
  'g',
);

export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  INLINE.lastIndex = 0;
  const re = new RegExp(INLINE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = k++;
    if (m[1]) out.push(<code key={key} className="md-code">{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<UserMention key={key} userId={m[3]} />);
    else if (m[4]) out.push(<ChannelLink key={key} conversationId={m[5]} />);
    else if (m[6]) out.push(<span key={key} className="mention mention-me">@{m[7]}</span>);
    else if (m[8]) out.push(<a key={key} href={m[9]} target="_blank" rel="noreferrer noopener">{m[10]}</a>);
    else if (m[11]) out.push(<a key={key} href={m[11]} target="_blank" rel="noreferrer noopener">{m[11]}</a>);
    else if (m[12]) out.push(<strong key={key}>{renderInline(m[13])}</strong>);
    else if (m[14]) out.push(<strong key={key}>{renderInline(m[15])}</strong>);
    else if (m[16]) out.push(<em key={key}>{renderInline(m[17])}</em>);
    else if (m[18]) out.push(<s key={key}>{renderInline(m[19])}</s>);
    else if (m[20]) {
      const emoji = emojiForShortcode(m[21]);
      out.push(emoji ? <span key={key} className="emoji-inline" role="img" aria-label={m[21]}>{emoji}</span> : m[20]);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function UserMention({ userId }: { userId: string }) {
  const member = useSession((s) => s.members[userId]);
  const isMe = useSession((s) => s.me?.id === userId);
  const open = useUi((s) => s.openRightPanel);
  return (
    <button type="button" className={`mention${isMe ? ' mention-me' : ''}`} onClick={() => open({ kind: 'profile', userId })}>
      @{member ? member.displayName || member.fullName : 'unknown'}
    </button>
  );
}

function ChannelLink({ conversationId }: { conversationId: string }) {
  const conv = useConversations((s) => s.byId[conversationId]);
  const wid = useSession((s) => s.workspaceId);
  const navigate = useNavigate();
  return (
    <button type="button" className="mention" onClick={() => wid && navigate(`/w/${wid}/c/${conversationId}`)}>
      #{conv?.name ?? 'channel'}
    </button>
  );
}

/** Plain-text preview (for notifications, quick switcher, saved list). */
export function plainText(text: string, names: { user?: (id: string) => string; conv?: (id: string) => string } = {}) {
  return text
    .replace(/<@([A-Z0-9]+)>/g, (_a, id) => `@${names.user?.(id) ?? 'someone'}`)
    .replace(/<#([A-Z0-9]+)>/g, (_a, id) => `#${names.conv?.(id) ?? 'channel'}`)
    .replace(/<!(channel|here|everyone)>/g, '@$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/```/g, '')
    .replace(/[*_~`]/g, '');
}
