import { describe, expect, it } from 'vitest';
import { extractTaskKeys, isReactionEmoji, titleFromMessage } from './task-keys.js';

describe('extractTaskKeys', () => {
  it('finds keys, upper-cases and de-duplicates them', () => {
    expect(extractTaskKeys('see SYN-12 and syn-12, also OPS-3.')).toEqual(['SYN-12', 'OPS-3']);
    expect(extractTaskKeys('(SYN-1) [SYN-2] SYN-3!')).toEqual(['SYN-1', 'SYN-2', 'SYN-3']);
  });

  it('ignores code, longer identifiers and urls', () => {
    expect(extractTaskKeys('`SYN-1` and ```\nSYN-2\n``` but SYN-3')).toEqual(['SYN-3']);
    expect(extractTaskKeys('https://x.io/SYN-1 pre-SYN-2 SYN-1a SYN-12-3')).toEqual([]);
    expect(extractTaskKeys('')).toEqual([]);
  });
});

describe('isReactionEmoji', () => {
  it('accepts emoji, including modifiers and sequences', () => {
    for (const e of ['👍', '🎉', '❤️', '👍🏽', '👨‍👩‍👧']) expect(isReactionEmoji(e), e).toBe(true);
  });
  it('rejects text, empty and oversized input', () => {
    for (const e of ['', 'a', ':+1:', '👍x', '👍'.repeat(20), '<script>']) expect(isReactionEmoji(e), e).toBe(false);
  });
});

describe('titleFromMessage', () => {
  it('uses the first non-empty line without markdown noise', () => {
    expect(titleFromMessage('\n\n## Login is broken\nmore text')).toBe('Login is broken');
    expect(titleFromMessage('[@Ann](mention:u1) please look at [this](https://x.io)')).toBe('@Ann please look at this');
    expect(titleFromMessage('   ')).toBe('Untitled');
    expect(titleFromMessage('x'.repeat(500))).toHaveLength(300);
  });
});
