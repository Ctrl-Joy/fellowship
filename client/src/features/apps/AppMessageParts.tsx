import { useState } from 'react';
import type { Conversation, Message, User } from '../../types';
import { Markdown } from '../../lib/markdown';
import { Icon } from '../../components/Icon';
import { useMessages } from '../../store/messages';
import { clickAction, votePoll } from './api';

export interface AppMessagePartsProps {
  message: Message;
  conversation: Conversation;
  currentUser: User;
}

interface ActionButton {
  actionId: string;
  text: string;
  value: string;
  style: 'default' | 'primary' | 'danger';
}

interface PollMeta {
  question: string;
  options: { id: string; text: string }[];
  voters?: Record<string, string[]>;
  counts?: Record<string, number>;
  totalVotes?: number;
}

/** Everything an app adds under a message: poll, buttons, section blocks, ephemeral note. */
export default function AppMessageParts({ message, currentUser }: AppMessagePartsProps) {
  const meta = message.meta ?? {};
  const ephemeral = message.subtype === 'ephemeral';
  const sections: { text: string }[] = Array.isArray(meta.blocks)
    ? meta.blocks.filter((b: any) => b?.type === 'section' && typeof b.text === 'string')
    : [];
  const actions: ActionButton[] = Array.isArray(meta.actions) ? meta.actions : [];

  return (
    <>
      {ephemeral && <div className="app-ephemeral-note">Only visible to you</div>}
      {sections.map((b, i) => (
        <div key={i} className="app-section"><Markdown text={b.text} /></div>
      ))}
      {meta.poll && <Poll message={message} poll={meta.poll as PollMeta} currentUser={currentUser} />}
      {actions.length > 0 && <Actions message={message} actions={actions} />}
    </>
  );
}

function Poll({ message, poll, currentUser }: { message: Message; poll: PollMeta; currentUser: User }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const voters = poll.voters ?? {};
  const total = poll.totalVotes ?? 0;
  const mine = Object.entries(voters).find(([, ids]) => ids.includes(currentUser.id))?.[0] ?? null;

  async function vote(optionId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await votePoll(message.id, optionId);
      useMessages.getState().upsert(r.message);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-poll" role="group" aria-label={poll.question}>
      {poll.options.map((o) => {
        const n = poll.counts?.[o.id] ?? 0;
        const pct = total ? Math.round((n * 100) / total) : 0;
        const active = mine === o.id;
        return (
          <button key={o.id} type="button" className={`app-poll-opt${active ? ' active' : ''}`} onClick={() => vote(o.id)} aria-pressed={active}>
            <span className="app-poll-bar" style={{ width: `${pct}%` }} />
            <span className="app-poll-label">
              {active && <Icon name="check" size={14} />}
              {o.text}
            </span>
            <span className="app-poll-count">{n} · {pct}%</span>
          </button>
        );
      })}
      <div className="app-poll-foot muted small">
        {total} {total === 1 ? 'vote' : 'votes'}{mine ? ' · pick another option to change your vote' : ' · pick an option to vote'}
      </div>
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

function Actions({ message, actions }: { message: Message; actions: ActionButton[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function click(a: ActionButton) {
    setBusy(a.actionId);
    setError(null);
    try {
      await clickAction(message.id, a.actionId, a.value);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="app-actions">
      {actions.map((a) => (
        <button
          key={a.actionId}
          type="button"
          className={`btn btn-sm app-action${a.style === 'primary' ? ' btn-primary' : ''}${a.style === 'danger' ? ' app-action-danger' : ''}`}
          disabled={busy !== null}
          onClick={() => click(a)}
        >
          {a.text}
        </button>
      ))}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
