import type { FeatureSetup } from '../types';
import { ws } from '../../ws';
import { useMessages } from '../../store/messages';
import './reactions.css';

/** Applies reaction.added / reaction.removed from any user to the message store, live. */
const setup: FeatureSetup = ({ workspaceId }) => {
  const apply = (p: { messageId: string; reactions: { emoji: string; userIds: string[] }[] }, frame: { workspaceId?: string | null }) => {
    if (frame.workspaceId && frame.workspaceId !== workspaceId) return;
    if (!p?.messageId || !Array.isArray(p.reactions)) return;
    useMessages.getState().patch(p.messageId, { reactions: p.reactions });
  };
  const offAdded = ws.on('reaction.added', apply);
  const offRemoved = ws.on('reaction.removed', apply);
  return () => { offAdded(); offRemoved(); };
};

export default setup;
