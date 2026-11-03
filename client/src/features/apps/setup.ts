import type { FeatureSetup } from '../types';
import { ws } from '../../ws';
import { useMessages } from '../../store/messages';
import type { Message } from '../../types';
import { loadAppCommands } from './commands';

/**
 * Once per workspace load: warm the slash-command list for the composer and show
 * ephemeral messages (only the invoking user receives them over WebSocket).
 */
const setup: FeatureSetup = ({ workspaceId }) => {
  void loadAppCommands(workspaceId);

  const off = ws.on('message.ephemeral', (p: { message: Message }, frame) => {
    if (frame.workspaceId && frame.workspaceId !== workspaceId) return;
    if (!p?.message) return;
    useMessages.getState().upsert(p.message);
  });

  return () => off();
};

export default setup;
