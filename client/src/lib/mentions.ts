import type { Conversation, Member } from '../types';

/**
 * Wire format for mentions inside message text:
 *   <@USERID>  user mention        <#CONVID>  channel link
 *   <!channel> <!here> <!everyone> broadcast mentions
 * The composer shows friendly `@name` / `#name` text; `encodeMentions` converts it on send
 * and `decodeMentions` converts back when editing.
 */
export const mentionHandle = (m: Pick<Member, 'displayName' | 'fullName'>) =>
  (m.displayName || m.fullName).replace(/\s+/g, '').toLowerCase();

export function encodeMentions(text: string, members: Record<string, Member>, channels: Conversation[]): string {
  const byHandle = new Map<string, string>();
  for (const m of Object.values(members)) byHandle.set(mentionHandle(m), m.id);
  const byName = new Map<string, string>();
  for (const c of channels) if (c.kind === 'channel' && c.name) byName.set(c.name, c.id);

  // Skip code spans / blocks.
  return text.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((part, i) => {
    if (i % 2 === 1) return part;
    return part.replace(/(^|[\s(>])([@#])([a-z0-9][\w.-]*)/gi, (all, pre: string, sigil: string, name: string) => {
      const n = name.toLowerCase().replace(/[.]+$/, '');
      const tail = name.slice(n.length);
      if (sigil === '@') {
        if (n === 'channel' || n === 'here' || n === 'everyone') return `${pre}<!${n}>${tail}`;
        const id = byHandle.get(n);
        return id ? `${pre}<@${id}>${tail}` : all;
      }
      const id = byName.get(n);
      return id ? `${pre}<#${id}>${tail}` : all;
    });
  }).join('');
}

export function decodeMentions(text: string, members: Record<string, Member>, conversations: Record<string, Conversation>): string {
  return text
    .replace(/<@([A-Z0-9]+)>/g, (all, id) => (members[id] ? `@${mentionHandle(members[id])}` : all))
    .replace(/<#([A-Z0-9]+)>/g, (all, id) => (conversations[id]?.name ? `#${conversations[id].name}` : all))
    .replace(/<!(channel|here|everyone)>/g, '@$1');
}
