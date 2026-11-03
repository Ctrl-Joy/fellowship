import { memo, useEffect, useRef, useState } from 'react';
import type { Conversation, Message, User } from '../types';
import { useSession, displayName } from '../store/session';
import { useMessages } from '../store/messages';
import { useConversations } from '../store/conversations';
import { useUi } from '../store/ui';
import { deleteMessage, editMessage, retrySend, togglePin, toggleSave } from '../store/actions';
import { Markdown } from '../lib/markdown';
import { decodeMentions, encodeMentions } from '../lib/mentions';
import { formatFull, formatTime, timeAgo } from '../lib/time';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import ReactionBar from '../features/reactions/ReactionBar';
import EmojiPicker from '../features/reactions/EmojiPicker';
import { toggleReaction } from '../features/reactions/api';
import Attachments from '../features/files/Attachments';
import WorkflowMessageParts from '../features/workflows/WorkflowMessageParts';
import CanvasShareCard from '../features/canvases/CanvasShareCard';
import WorkItemCard from '../features/projects/WorkItemCard';
import AppMessageParts from '../features/apps/AppMessageParts';

export interface MessageItemProps {
  message: Message;
  conversation: Conversation;
  currentUser: User;
  workspaceId: string;
  /** false = grouped under the previous message from the same author. */
  showHeader: boolean;
  /** Rendered inside the thread panel (hides "reply in thread" + thread summary). */
  inThread?: boolean;
}

export const MessageItem = memo(function MessageItem({ message: m, conversation, currentUser, showHeader, inThread }: MessageItemProps) {
  const author = useSession((s) => s.members[m.userId]);
  const myRole = useSession((s) => s.members[currentUser.id]?.role);
  const editing = useMessages((s) => s.editingId === m.id);
  const openPanel = useUi((s) => s.openRightPanel);
  const [picker, setPicker] = useState(false);
  const mine = m.userId === currentUser.id;
  const isAdmin = myRole === 'owner' || myRole === 'admin';
  const temp = m.id.startsWith('tmp_');
  const canReplyHere = !inThread && !m.threadRootId && !m.deletedAt && !temp;

  if (m.deletedAt) {
    return (
      <div className={`msg msg-deleted${showHeader ? ' msg-head' : ''}`} data-mid={m.id}>
        <div className="msg-gutter">{showHeader ? <div className="avatar avatar-ghost" /> : null}</div>
        <div className="msg-main">
          <div className="msg-text muted"><em>This message was deleted.</em></div>
          {!inThread && m.replyCount > 0 && <ThreadSummary message={m} onOpen={() => openPanel({ kind: 'thread', conversationId: conversation.id, rootId: m.id })} />}
        </div>
      </div>
    );
  }

  const openThread = () => openPanel({ kind: 'thread', conversationId: conversation.id, rootId: m.threadRootId ?? m.id });

  return (
    <div className={`msg${showHeader ? ' msg-head' : ''}${m.pending ? ' msg-pending' : ''}${m.failed ? ' msg-failed' : ''}${m.pinned ? ' msg-pinned' : ''}${editing ? ' msg-editing' : ''}`} data-mid={m.id}>
      {m.pinned && <div className="msg-pinned-label"><Icon name="pin" size={12} /> Pinned</div>}
      {m.subtype === 'thread_broadcast' && !inThread && (
        <button className="msg-broadcast-label" onClick={openThread}>replied to a thread</button>
      )}
      <div className="msg-row">
        <div className="msg-gutter">
          {showHeader
            ? <button className="avatar-btn" onClick={() => openPanel({ kind: 'profile', userId: m.userId })}><Avatar userId={m.userId} size={36} /></button>
            : <span className="msg-hover-time" title={formatFull(m.createdAt)}>{formatTime(m.createdAt)}</span>}
        </div>
        <div className="msg-main">
          {showHeader && (
            <div className="msg-meta">
              <button className="msg-author" onClick={() => openPanel({ kind: 'profile', userId: m.userId })}>{m.meta?.override?.username ?? displayName(author)}</button>
              {author?.isBot && <span className="badge-app">APP</span>}
              {author?.statusEmoji && <span title={author.statusText}>{author.statusEmoji}</span>}
              <time className="msg-time" title={formatFull(m.createdAt)}>{formatTime(m.createdAt)}</time>
            </div>
          )}
          {editing ? (
            <InlineEditor message={m} />
          ) : (
            <div className="msg-text">
              <Markdown text={m.text} />
              {m.editedAt && <span className="msg-edited" title={formatFull(m.editedAt)}>(edited)</span>}
            </div>
          )}
          <Attachments message={m} files={m.files} />
          <CanvasShareCard message={m} />
          <WorkItemCard message={m} />
          <WorkflowMessageParts message={m} conversation={conversation} currentUser={currentUser} />
          <AppMessageParts message={m} conversation={conversation} currentUser={currentUser} />
          <ReactionBar message={m} conversation={conversation} currentUser={currentUser} />
          {m.failed && (
            <div className="msg-error">
              Not sent. <button className="link" onClick={() => retrySend(m.id)}>Retry</button> · <button className="link" onClick={() => deleteMessage(m.id)}>Discard</button>
            </div>
          )}
          {!inThread && m.replyCount > 0 && <ThreadSummary message={m} onOpen={openThread} />}
        </div>
      </div>

      {!temp && !editing && (
        <div className={`msg-toolbar${picker ? ' open' : ''}`} role="toolbar">
          <button className="icon-btn" title="Add reaction" data-emoji-trigger onClick={() => setPicker((v) => !v)}><Icon name="smile" size={16} /></button>
          {canReplyHere && <button className="icon-btn" title="Reply in thread" onClick={openThread}><Icon name="thread" size={16} /></button>}
          <button className={`icon-btn${m.saved ? ' active' : ''}`} title={m.saved ? 'Remove from saved' : 'Save for later'} onClick={() => toggleSave(m)}><Icon name="bookmark" size={16} /></button>
          {conversation.isMember && <button className={`icon-btn${m.pinned ? ' active' : ''}`} title={m.pinned ? 'Unpin' : 'Pin to conversation'} onClick={() => togglePin(m)}><Icon name="pin" size={16} /></button>}
          {mine && <button className="icon-btn" title="Edit" onClick={() => useMessages.getState().setEditing(m.id)}><Icon name="edit" size={16} /></button>}
          {(mine || isAdmin) && (
            <button className="icon-btn danger" title="Delete" onClick={() => { if (confirm('Delete this message? This can’t be undone.')) deleteMessage(m.id); }}>
              <Icon name="trash" size={16} />
            </button>
          )}
          {picker && (
            <div className="msg-picker">
              <EmojiPicker onPick={(e) => toggleReaction(m, e, currentUser.id)} onClose={() => setPicker(false)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function ThreadSummary({ message, onOpen }: { message: Message; onOpen(): void }) {
  return (
    <button className="thread-summary" onClick={onOpen}>
      <span className="thread-avatars">{message.replyUserIds.slice(0, 4).map((id) => <Avatar key={id} userId={id} size={20} />)}</span>
      <span className="thread-count">{message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}</span>
      {message.lastReplyAt && <span className="muted small">Last reply {timeAgo(message.lastReplyAt)}</span>}
      <span className="thread-view">View thread</span>
    </button>
  );
}

function InlineEditor({ message }: { message: Message }) {
  const members = useSession((s) => s.members);
  const conversations = useConversations((s) => s.byId);
  const [text, setText] = useState(() => decodeMentions(message.text, members, conversations));
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, []);
  const cancel = () => useMessages.getState().setEditing(null);
  const save = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await editMessage(message.id, encodeMentions(text, members, Object.values(conversations)));
      cancel();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="inline-editor">
      <textarea ref={ref} className="input" value={text} rows={Math.min(10, text.split('\n').length + 1)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
        }} />
      <div className="row gap-sm">
        <button className="btn btn-sm" onClick={cancel}>Cancel</button>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={save}>Save</button>
        <span className="muted small">Enter to save · Esc to cancel</span>
      </div>
    </div>
  );
}
