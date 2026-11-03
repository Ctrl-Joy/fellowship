import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import type { Conversation, Message, User } from '../types';
import { useMessages } from '../store/messages';
import { useSession, displayName } from '../store/session';
import { conversationTitle, dmPartnerId } from '../store/conversations';
import { loadOlderMessages, markRead } from '../store/actions';
import { isViewing } from '../store/realtime';
import { dayKey, formatDay, formatFull } from '../lib/time';
import { MessageItem } from './MessageItem';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { useUi } from '../store/ui';
import PresenceDot from '../features/presence/PresenceDot';

const GROUP_WINDOW = 5 * 60_000;

export function MessageList({ conversation, currentUser, workspaceId }: {
  conversation: Conversation;
  currentUser: User;
  workspaceId: string;
}) {
  const page = useMessages((s) => s.channels[conversation.id]);
  const byId = useMessages((s) => s.byId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prevFirst = useRef<string | null>(null);
  const prevHeight = useRef(0);
  const [dividerTs, setDividerTs] = useState<number | null>(null);

  // Capture the "new messages" line position when opening a conversation.
  useEffect(() => {
    setDividerTs(conversation.unreadCount > 0 ? conversation.lastReadTs : null);
    atBottom.current = true;
    prevFirst.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  const ids = page?.ids ?? [];
  const messages = ids.map((id) => byId[id]).filter(Boolean) as Message[];
  const lastId = messages.length ? messages[messages.length - 1].id : null;
  const firstId = messages.length ? messages[0].id : null;

  // Keep position when older messages are prepended; stick to bottom for new ones.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevFirst.current && firstId !== prevFirst.current && ids.indexOf(prevFirst.current) > 0) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevFirst.current = firstId;
    prevHeight.current = el.scrollHeight;
  });

  // Mark read when the newest message is visible and the window is focused.
  useEffect(() => {
    const latest = [...messages].reverse().find((m) => !m.pending && !m.id.startsWith('tmp_'));
    if (!latest || !conversation.isMember) return;
    const tryMark = () => {
      if (atBottom.current && isViewing(conversation.id)) markRead(conversation.id, latest.createdAt);
    };
    tryMark();
    window.addEventListener('focus', tryMark);
    document.addEventListener('visibilitychange', tryMark);
    return () => {
      window.removeEventListener('focus', tryMark);
      document.removeEventListener('visibilitychange', tryMark);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, conversation.id, conversation.isMember, conversation.unreadCount]);

  // Jump target from search (?m=<messageId>): scroll to it and flash it. Added for the search feature.
  const location = useLocation();
  const jumpId = new URLSearchParams(location.search).get('m');
  useEffect(() => {
    if (!jumpId || !page?.loaded) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-mid="${CSS.escape(jumpId)}"]`);
    if (!el) return;
    atBottom.current = false;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('msg-jump');
    const t = window.setTimeout(() => el.classList.remove('msg-jump'), 2400);
    return () => { window.clearTimeout(t); el.classList.remove('msg-jump'); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpId, page?.loaded, ids.length]);

  function onScroll() {
    const el = scrollRef.current!;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (el.scrollTop < 200 && page?.hasMore && !page.loading) loadOlderMessages(conversation.id);
    if (atBottom.current && lastId) {
      const last = byId[lastId];
      if (last && !last.pending && isViewing(conversation.id)) markRead(conversation.id, last.createdAt);
    }
  }

  if (!page?.loaded) {
    return <div className="msg-list"><div className="loading-block"><span className="spinner" /> Loading messages…</div></div>;
  }

  let dividerShown = false;
  return (
    <div className="msg-list" ref={scrollRef} onScroll={onScroll}>
      {page.hasMore
        ? <div className="loading-older">{page.loading ? <><span className="spinner" /> Loading earlier messages…</> : ' '}</div>
        : <ConversationIntro conversation={conversation} currentUser={currentUser} />}
      {messages.map((m, i) => {
        const prev = i > 0 ? messages[i - 1] : null;
        const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
        const isNew = dividerTs != null && !dividerShown && m.createdAt > dividerTs && m.userId !== currentUser.id && !m.pending;
        if (isNew) dividerShown = true;
        const grouped = !!prev && !newDay && !isNew && prev.userId === m.userId && !prev.deletedAt && !m.deletedAt
          && m.createdAt - prev.createdAt < GROUP_WINDOW && !m.subtype && !prev.subtype && !m.pinned;
        return (
          <Fragment key={m.id}>
            {newDay && <div className="day-divider"><span title={formatFull(m.createdAt)}>{formatDay(m.createdAt)}</span></div>}
            {isNew && <div className="new-divider"><span>New</span></div>}
            <MessageItem message={m} conversation={conversation} currentUser={currentUser} workspaceId={workspaceId} showHeader={!grouped} />
          </Fragment>
        );
      })}
      <div className="msg-list-end" />
    </div>
  );
}

function ConversationIntro({ conversation, currentUser }: { conversation: Conversation; currentUser: User }) {
  const members = useSession((s) => s.members);
  const creator = conversation.createdBy ? members[conversation.createdBy] : undefined;
  if (conversation.kind === 'channel') {
    return (
      <div className="intro">
        <div className="intro-icon"><Icon name={conversation.isPrivate ? 'lock' : 'hash'} size={28} /></div>
        <h2>{conversation.isPrivate ? '' : '#'}{conversation.name}</h2>
        <p className="muted">
          {creator ? <>{displayName(creator)} created this channel on {new Date(conversation.createdAt).toLocaleDateString([], { month: 'long', day: 'numeric' })}. </> : null}
          This is the very beginning of <strong>#{conversation.name}</strong>.
          {conversation.description ? <> {conversation.description}</> : null}
        </p>
      </div>
    );
  }
  const isSelf = conversation.kind === 'self';
  const personId = isSelf ? currentUser.id : dmPartnerId(conversation, currentUser.id);
  const title = conversationTitle(conversation, members, currentUser);
  return (
    <div className="intro">
      <div className="intro-who">
        {personId ? <Avatar userId={personId} size={116} /> : <div className="intro-icon"><Icon name="users" size={28} /></div>}
        <h2>{title}{isSelf && ' (you)'}</h2>
        {personId && <PresenceDot userId={personId} size={11} />}
      </div>
      <p className="intro-lead">
        {isSelf
          ? <><strong>This space is just for you.</strong> Park drafts, keep a running to-do list, and stash links and files you want close at hand. Nobody else can see what you put here.</>
          : <>This is the start of your direct messages with <strong>{title}</strong>. Only the people in this conversation can see what's shared here.</>}
      </p>
      {personId && (
        <button className="btn btn-outline" onClick={() => useUi.getState().openRightPanel({ kind: 'profile', userId: personId })}>
          {isSelf ? 'Edit profile' : 'View profile'}
        </button>
      )}
    </div>
  );
}
