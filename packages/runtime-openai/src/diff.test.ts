import { describe, expect, it } from 'vitest';
import { lineDiff } from './diff.js';

describe('lineDiff', () => {
  it('shows changed lines with context and elides the rest', () => {
    const before = 'a b c d e f g h i j'.split(' ').join('\n');
    const after = 'a b c D e f g h i j k'.split(' ').join('\n');
    expect(lineDiff(before, after)).toBe(
      [
        '@@ -2 +2 @@',
        ' b',
        ' c',
        '-d',
        '+D',
        ' e',
        ' f',
        '@@ -9 +9 @@',
        ' i',
        ' j',
        '+k',
      ].join('\n'),
    );
  });

  it('is empty when nothing changed, and summarises huge inputs', () => {
    expect(lineDiff('x', 'x')).toBe('');
    // A new file is all additions, with no phantom blank line removed.
    expect(lineDiff('', 'new file\n')).toBe('@@ -1 +1 @@\n+new file');
    expect(lineDiff('a\n', 'a\nb\n')).toBe('@@ -1 +1 @@\n a\n+b');
    const big = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join('\n');
    expect(lineDiff(big, `${big}\nmore`)).toMatch(/diff too large/);
  });
});
