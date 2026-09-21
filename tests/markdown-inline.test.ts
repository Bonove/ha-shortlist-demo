import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The assistant's replies are Markdown, and the chat renders a small subset of
 * it. This pins the inline splitter — the only part with enough regex in it to
 * get subtly wrong — by reading the pattern straight out of the component, so
 * the test cannot drift away from what actually ships.
 */
const source = readFileSync('src/components/chat/markdown.tsx', 'utf8');
const pattern = /^const INLINE = \/(.*)\/g;$/m.exec(source)?.[1];

type Part = ['b' | 'i' | 'code' | 'text', string];

function split(text: string): Part[] {
  // The extracted pattern already carries its own capture group; wrapping it
  // again would make split() emit each group separately.
  const inline = new RegExp(pattern!, 'g');
  return text
    .split(inline)
    .filter(Boolean)
    .map((p): Part =>
      p.startsWith('**') ? ['b', p.slice(2, -2)]
      : p.startsWith('`') ? ['code', p.slice(1, -1)]
      : p.startsWith('*') ? ['i', p.slice(1, -1)]
      : ['text', p],
    );
}

describe('assistant markdown', () => {
  it('reads its pattern from the component', () => {
    expect(pattern).toBeTruthy();
  });

  it('picks out bold runs in a real answer', () => {
    const parts = split('Both meet your **€1,200 monthly budget** and your **five-month stay**.');
    expect(parts.filter(([kind]) => kind === 'b').map(([, t]) => t)).toEqual([
      '€1,200 monthly budget',
      'five-month stay',
    ]);
  });

  it('handles a cost breakdown bullet', () => {
    const parts = split('- **City Room:** €1,150 first month + €150 booking fee = **€2,450**, within your limit.');
    expect(parts.filter(([kind]) => kind === 'b').map(([, t]) => t)).toEqual(['City Room:', '€2,450']);
  });

  it('leaves plain text alone', () => {
    expect(split('plain text with no marks')).toEqual([['text', 'plain text with no marks']]);
  });

  it('renders inline code', () => {
    expect(split('a `code_span` here')).toContainEqual(['code', 'code_span']);
  });

  it('does not turn arithmetic into italics', () => {
    expect(split('2 * 3 * 4 is arithmetic, not italics')).toEqual([
      ['text', '2 * 3 * 4 is arithmetic, not italics'],
    ]);
  });

  it('still italicises a genuine emphasis span', () => {
    expect(split('a *word* in italics')).toContainEqual(['i', 'word']);
    expect(split('*a* single letter')).toContainEqual(['i', 'a']);
  });
});
