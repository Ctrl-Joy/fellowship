import { ALL_EMOJI, shortcodeFor } from './emojiData';

const byCode = new Map<string, string>();
for (const e of ALL_EMOJI) {
  const code = shortcodeFor(e);
  if (code && !byCode.has(code)) byCode.set(code, e.emoji);
}
// Single-word keywords become aliases when they do not clash with a name.
for (const e of ALL_EMOJI) {
  for (const k of e.keywords) {
    const alias = k.toLowerCase();
    if (/^[a-z][a-z0-9_]*$/.test(alias) && !byCode.has(alias)) byCode.set(alias, e.emoji);
  }
}

/** Emoji for a `:shortcode:` name (without colons), or null when unknown. */
export function emojiForShortcode(name: string): string | null {
  return byCode.get(name.toLowerCase()) ?? null;
}
