/** Task keys such as `SYN-12` in a message, ignoring code spans and code blocks. Upper-cased, unique, in order. */
export function extractTaskKeys(markdown: string | null | undefined): string[] {
  if (!markdown) return [];
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  const keys = new Set<string>();
  for (const m of withoutCode.matchAll(/(?<![\w/-])([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,9})(?![\w-])/g)) {
    keys.add(`${m[1].toUpperCase()}-${m[2]}`);
  }
  return [...keys];
}

/** Emoji accepted for reactions: pictographs with optional modifiers, joiners and variation selectors. */
const EMOJI = /^(?:\p{Extended_Pictographic}(?:\u200d|\ufe0f|\p{Emoji_Modifier})*)+$/u;
export const isReactionEmoji = (value: string) => value.length <= 16 && EMOJI.test(value);

/** First line of a message as a short title, with markdown mentions reduced to plain names. */
export function titleFromMessage(body: string): string {
  const firstLine = body.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? 'Untitled';
  const plain = firstLine
    .replace(/\[@([^\]]+)\]\(mention:[^)]+\)/g, '@$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[#>*\-\s]+/, '')
    .trim();
  return (plain || 'Untitled').slice(0, 300);
}
