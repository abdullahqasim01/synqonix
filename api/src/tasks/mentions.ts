const MENTION = /\[@[^\]\n]{1,100}\]\(mention:([A-Za-z0-9-]{8,64})\)/g;

/** User ids mentioned in markdown via `[@Name](mention:<userId>)`, de-duplicated, in order. */
export function extractMentionedUserIds(markdown: string | null | undefined): string[] {
  if (!markdown) return [];
  const ids = new Set<string>();
  for (const m of markdown.matchAll(MENTION)) ids.add(m[1]);
  return [...ids];
}
