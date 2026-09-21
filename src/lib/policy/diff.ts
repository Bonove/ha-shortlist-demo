/**
 * A line diff over policy source. Plain LCS — the specs are a few dozen lines,
 * so an O(n·m) table is cheaper than a dependency.
 */

import type { PolicySourceFile } from '@/lib/contracts';

export interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  text: string;
}

/** Render a bundle as one text, with a header per file when there is more than one. */
export function bundleText(files: PolicySourceFile[]): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  if (sorted.length === 1) return sorted[0].code;
  return sorted.map((f) => `--- ${f.path}\n${f.code}`).join('\n');
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n/g, '\n').split('\n');
  const b = after.replace(/\r\n/g, '\n').split('\n');

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'ctx', text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: 'del', text: a[i] });
      i += 1;
    } else {
      out.push({ type: 'add', text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) out.push({ type: 'del', text: a[i++] });
  while (j < b.length) out.push({ type: 'add', text: b[j++] });
  return out;
}

export function diffBundles(before: PolicySourceFile[], after: PolicySourceFile[]): DiffLine[] {
  return diffLines(bundleText(before), bundleText(after));
}
