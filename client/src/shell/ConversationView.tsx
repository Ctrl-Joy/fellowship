import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { Conversation, User } from '../types';
import { useConversations, conversationTitle, dmPartnerId } from '../store/conversations';
import { useMessages } from '../store/messages';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { fetchConversation, loadLatestMessages, markRead } from '../store/actions';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { TypingIndicator } from './TypingIndicator';
import { PinsTab } from './PinsTab';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { toggleStar, useStarred } from '../lib/starred';
import HuddleButton from '../features/huddles/HuddleButton';
import CanvasView from '../features/canvases/CanvasView';
import FilesTab from '../features/files/FilesTab';
import PresenceDot from '../features/presence/PresenceDot';
import WorkflowShortcuts from '../features/workflows/WorkflowShortcuts';

type Tab = 'messages' | 'canvas' | 'files' | 'pins';

/** Prefill the top-bar search with an `in:` filter for this conversation. */
function focusSearch(conversation: Conversation, title: string) {
  const input = document.querySelector<HTMLInputElement>('.topbar-search input');
  if (!input) return;
  const scope = conversation.kind === 'channel' ? `in:#${conversation.name} ` : `in:@${title} `;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, scope);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}

export function ConversationView({ workspaceId, currentUser }: { workspaceId: string; currentUser: User }) {
  const { cid } = useParams<{ cid: string }>();
  const conversation = useConversations((s) => (cid ? s.byId[cid] : undefined));
  const loaded = useConversations((s) => s.loaded);
  const page = useMessages((s) => (cid ? s.channels[cid] : undefined));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cid) return;
    useConversations.getState().setActive(cid);
    try { localStorage.setItem(`fs:last:${workspaceId}`, cid); } catch { /* ignore */ }
    return () => {
      if (useConversations.getState().activeId === cid) useConversations.getState().setActive(null);
    };
  }, [cid, workspaceId]);

  // Previewing a channel you're not in (or a conversation not loaded yet).
  useEffect(() => {
    if (!cid || !loaded || conversation) return;
    setError(null);
    fetchConversation(cid).catch((e) => setError(e.status === 403 ? 'You don’t have access to this conversation.' : e.message));
  }, [cid, loaded, conversation]);

  useEffect(() => {
    if (!cid || !conversation) return;
    loadLatestMessages(cid).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, !!conversation]);

  // Esc marks the whole conversation as read.
  useEffect(() => {
    if (!conversation) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || useUi.getState().modal) return;
      const ids = useMessages.getState().channels[conversation.id]?.ids ?? [];
      const last = useMessages.getState().byId[ids[ids.length - 1]];
      if (last) markRead(conversation.id, last.createdAt);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [conversation]);

  if (error) return <div className="view"><div className="empty">{error}</div></div>;
  if (!conversation) return <div className="view"><div className="loading-block"><span className="spinner" /> Loading…</div></div>;

  return (
    <ConversationBody conversation={conversation} currentUser={currentUser} workspaceId={workspaceId} hasPage={!!page?.loaded} />
  );
}

function ConversationBody({ conversation, currentUser, workspaceId }: { conversation: Conversation; currentUser: User; workspaceId: string; hasPage: boolean }) {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'messages';
  const setTab = (t: Tab) => setParams(t === 'messages' ? {} : { tab: t }, { replace: true });
  return (
    <div className="conversation">
      <ConversationHeader conversation={conversation} currentUser={currentUser} workspaceId={workspaceId} tab={tab} setTab={setTab} />
      {tab === 'messages' && (
        <>
          <MessageList conversation={conversation} currentUser={currentUser} workspaceId={workspaceId} />
          <div className="composer-wrap">
            <Composer conversation={conversation} workspaceId={workspaceId} />
            <TypingIndicator conversationId={conversation.id} />
          </div>
        </>
      )}
      {tab === 'canvas' && <div className="tab-body"><CanvasView workspaceId={workspaceId} conversation={conversation} currentUser={currentUser} /></div>}
      {tab === 'files' && <div className="tab-body"><FilesTab workspaceId={workspaceId} conversation={conversation} currentUser={currentUser} /></div>}
      {tab === 'pins' && <div className="tab-body"><PinsTab conversation={conversation} currentUser={currentUser} workspaceId={workspaceId} /></div>}
    </div>
  );
}

function ConversationHeader({ conversation, currentUser, workspaceId, tab, setTab }: {
  conversation: Conversation; currentUser: User; workspaceId: string; tab: Tab; setTab(t: Tab): void;
}) {
  const members = useSession((s) => s.members);
  const openPanel = useUi((s) => s.openRightPanel);
  const title = conversationTitle(conversation, members, currentUser);
  const partner = dmPartnerId(conversation, currentUser.id);
  const isChannel = conversation.kind === 'channel';
  const memberIds = conversation.memberIds ?? [];
  const openModal = useUi((s) => s.openModal);
  const starred = useStarred().includes(conversation.id);
  const tabs: [Tab, string, string][] = [['messages', 'Messages', 'thread'], ['canvas', 'Canvas', 'canvas'], ['files', 'Files', 'file'], ['pins', 'Pins', 'pin']];
  const selfId = conversation.kind === 'self' ? currentUser.id : partner;

  return (
    <header className="conv-head">
      <div className="conv-head-row">
        <button className={`icon-btn star-btn${starred ? ' on' : ''}`} title={starred ? 'Unstar' : 'Star conversation'}
          aria-pressed={starred} onClick={() => toggleStar(conversation.id)}><Icon name="star" size={19} /></button>
        <button className="conv-title" onClick={() => openPanel(selfId && !isChannel ? { kind: 'profile', userId: selfId } : { kind: 'details', conversationId: conversation.id })}>
          {isChannel ? <Icon name={conversation.isPrivate ? 'lock' : 'hash'} size={18} /> : selfId ? (
            <span className="avatar-wrap"><Avatar userId={selfId} size={24} /><PresenceDot userId={selfId} size={8} /></span>
          ) : <Icon name="users" size={18} />}
          <span className="conv-name">{title}</span>
          {conversation.isArchived && <span className="tag">Archived</span>}
          <Icon name="chevronDown" size={14} />
        </button>
        {conversation.topic && <span className="conv-topic" title={conversation.topic}>{conversation.topic}</span>}
        <div className="conv-actions">
          {(isChannel || conversation.kind === 'group_dm') && (
            <button className="member-stack" onClick={() => openPanel({ kind: 'details', conversationId: conversation.id, tab: 'members' })} title="View members">
              {memberIds.slice(0, 3).map((id) => <Avatar key={id} userId={id} size={22} />)}
              <span>{conversation.memberCount}</span>
            </button>
          )}
          <WorkflowShortcuts workspaceId={workspaceId} conversation={conversation} currentUser={currentUser} />
          <HuddleButton workspaceId={workspaceId} conversation={conversation} currentUser={currentUser} />
          <button className="icon-btn" title="Notification settings" onClick={() => openModal({ kind: 'notificationPrefs', conversationId: conversation.id })}><Icon name="bell" size={19} /></button>
          <button className="icon-btn" title="Search in this conversation" onClick={() => focusSearch(conversation, title)}><Icon name="search" size={19} /></button>
          <button className="icon-btn" title="Conversation details" onClick={() => openPanel({ kind: 'details', conversationId: conversation.id })}><Icon name="dots" size={19} /></button>
        </div>
      </div>
      <nav className="tabs">
        {tabs.map(([key, label, icon]) => (
          <button key={key} className={`tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>
            <Icon name={icon} size={15} /> {label}
          </button>
        ))}
        <button className="tab-add" title="Open the canvas" onClick={() => setTab('canvas')}><Icon name="plus" size={16} /></button>
      </nav>
    </header>
  );
}
