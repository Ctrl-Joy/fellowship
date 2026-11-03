import type { NotificationItem } from './store';
import { useSession, displayName } from '../../store/session';
import { useConversations } from '../../store/conversations';

/** One-line description of a notification, written for the activity feed and desktop alerts. */
export function describeNotification(n: NotificationItem, actor: string, convLabel: string | null): string {
  const where = convLabel ? ` in ${convLabel}` : '';
  switch (n.kind) {
    case 'dm': return `${actor} sent you a direct message`;
    case 'mention': return `${actor} mentioned you${where}`;
    case 'thread_reply': return `${actor} replied in a thread${where}`;
    case 'reaction': return `${actor} reacted ${n.emoji || 'with an emoji'} to your message${where}`;
    case 'keyword': return `${actor} said a keyword you follow${where}`;
    case 'channel_broadcast': return `${actor} posted${where}`;
  }
}

/** Channel label as shown in the feed: #name for channels, the other people for DMs. */
export function channelLabel(n: NotificationItem): string | null {
  if (n.conversationKind === 'channel' && n.conversationName) return `#${n.conversationName}`;
  return null;
}

/** Plain text to show under the description (mention markup is removed). */
export function previewText(text: string | null): string {
  if (text == null) return 'This message was deleted.';
  return text
    .replace(/<@([A-Za-z0-9]+)>/g, (_m, id) => {
      const u = useSession.getState().members[id];
      return u ? `@${displayName(u)}` : '@someone';
    })
    .replace(/<!(channel|everyone|here)>/g, (_m, g) => `@${g}`)
    // <#C123|name> carries its label; bare <#C123> is looked up in the loaded conversations.
    .replace(/<#([A-Za-z0-9]+)\|?([^>]*)>/g, (_m, id, g) => `#${g || useConversations.getState().byId[id]?.name || 'channel'}`)
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
    // Drop paired markdown markers (**bold**, _italic_, ~strike~, `code`) but keep lone characters.
    .replace(/```/g, '')
    .replace(/(\*\*|\*|__|_|~~|~|`)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/(\*\*|\*|__|_|~~|~|`)(\S(?:.*?\S)?)\1/g, '$2') // second pass for nested markers
    .replace(/\s+/g, ' ')
    .trim();
}
