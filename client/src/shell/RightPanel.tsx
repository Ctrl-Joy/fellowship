import type { User } from '../types';
import { useUi } from '../store/ui';
import { useConversations } from '../store/conversations';
import ThreadPanel from '../features/threads/ThreadPanel';
import ProfilePanel from '../features/presence/ProfilePanel';
import { ChannelDetails } from './ChannelDetails';

export function RightPanel({ workspaceId, currentUser }: { workspaceId: string; currentUser: User }) {
  const panel = useUi((s) => s.rightPanel);
  const close = useUi((s) => s.closeRightPanel);
  const conv = useConversations((s) => (panel && 'conversationId' in panel ? s.byId[panel.conversationId] : undefined));
  if (!panel) return null;
  switch (panel.kind) {
    case 'thread':
      if (!conv) return null;
      return <ThreadPanel key={panel.rootId} workspaceId={workspaceId} conversation={conv} rootId={panel.rootId} currentUser={currentUser} onClose={close} />;
    case 'details':
      if (!conv) return null;
      return <ChannelDetails key={conv.id} workspaceId={workspaceId} conversation={conv} currentUser={currentUser} initialTab={panel.tab} onClose={close} />;
    case 'profile':
      return <ProfilePanel key={panel.userId} workspaceId={workspaceId} userId={panel.userId} currentUser={currentUser} onClose={close} />;
    default:
      return null;
  }
}
