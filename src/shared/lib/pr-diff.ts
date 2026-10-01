export interface DiffLine { text: string; kind: 'hunk' | 'add' | 'remove' | 'context' | 'meta'; oldLine?: number; newLine?: number }
/** Interpret only coordinates declared by valid unified-diff hunks. */
export function parseDiff(patch: string): DiffLine[] {
  let oldLine = 0, newLine = 0, oldRemaining = 0, newRemaining = 0;
  return patch.split('\n').map(text => {
    const hunk = text.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[3]); oldRemaining = Number(hunk[2] ?? 1); newRemaining = Number(hunk[4] ?? 1); return { text, kind: 'hunk' }; }
    if (text.startsWith('+') && newRemaining > 0) { newRemaining--; return { text, kind: 'add', newLine: newLine++ }; }
    if (text.startsWith('-') && oldRemaining > 0) { oldRemaining--; return { text, kind: 'remove', oldLine: oldLine++ }; }
    if (text.startsWith(' ') && oldRemaining > 0 && newRemaining > 0) { oldRemaining--; newRemaining--; return { text, kind: 'context', oldLine: oldLine++, newLine: newLine++ }; }
    return { text, kind: 'meta' };
  });
}
