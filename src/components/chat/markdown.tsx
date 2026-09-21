import { Fragment, type ReactNode } from 'react';

/**
 * The little bit of Markdown the assistant actually emits: paragraphs, bullet
 * and numbered lists, bold, italics and inline code.
 *
 * Built as React elements rather than HTML, so model output is escaped by
 * construction and there is no sanitiser to get wrong. Anything unrecognised
 * falls through as plain text, which is the right failure: a stray asterisk is
 * better than a broken bubble.
 */

// Italics must not touch whitespace, or arithmetic like `2 * 3 * 4` reads as
// an emphasis span.
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|(?<![*\w])\*(?!\s)(?:[^*\n]*[^\s*])?\*(?!\*))/g;

const BULLET = /^\s*[-*+]\s+/;
const NUMBER = /^\s*\d+[.)]\s+/;
const HEADING = /^(#{1,3})\s+(.*)$/;

function inline(text: string, key: string): ReactNode {
  return (
    <Fragment key={key}>
      {text.split(INLINE).map((part, i) => {
        if (!part) return null;
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="mono">{part.slice(1, -1)}</code>;
        if (part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>;
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </Fragment>
  );
}

type Kind = 'bullet' | 'number' | 'text';
const kindOf = (line: string): Kind =>
  BULLET.test(line) ? 'bullet' : NUMBER.test(line) ? 'number' : 'text';

/**
 * Group consecutive lines of the same kind. A lead-in sentence followed by
 * bullets is the shape the assistant uses most, and it arrives as one block
 * with single newlines — so the grouping has to happen per run of lines, not
 * per blank-line-separated block.
 */
function runs(lines: string[]): { kind: Kind; lines: string[] }[] {
  return lines.reduce<{ kind: Kind; lines: string[] }[]>((acc, line) => {
    const kind = kindOf(line);
    const last = acc[acc.length - 1];
    if (last && last.kind === kind) last.lines.push(line);
    else acc.push({ kind, lines: [line] });
    return acc;
  }, []);
}

export function Markdown({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="md">
      {blocks.flatMap((block, b) =>
        runs(block.split('\n')).map((run, r) => {
          const key = `${b}-${r}`;

          if (run.kind === 'bullet' || run.kind === 'number') {
            const List = run.kind === 'bullet' ? 'ul' : 'ol';
            const strip = run.kind === 'bullet' ? BULLET : NUMBER;
            return (
              <List key={key}>
                {run.lines.map((l, i) => (
                  <li key={i}>{inline(l.replace(strip, ''), `${key}-${i}`)}</li>
                ))}
              </List>
            );
          }

          const heading = HEADING.exec(run.lines[0]);
          if (heading && run.lines.length === 1) return <h4 key={key}>{inline(heading[2], `${key}-h`)}</h4>;

          // Single newlines inside a paragraph are kept: the assistant uses
          // them to break a cost breakdown onto its own lines.
          return (
            <p key={key}>
              {run.lines.map((l, i) => (
                <Fragment key={i}>
                  {i > 0 && <br />}
                  {inline(l, `${key}-${i}`)}
                </Fragment>
              ))}
            </p>
          );
        }),
      )}
    </div>
  );
}
