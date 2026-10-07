import { diffLines } from 'diff';

export function draftDiff(before: string, after: string) {
  // diffLines is bounded by both input sizes and an execution timeout.
  if (before.length > 100000 || after.length > 100000) return { additions: null, deletions: null, rows: [], limited: true };
  const old = before.replace(/\r\n/g, '\n'), next = after.replace(/\r\n/g, '\n');
  const parts = diffLines(old, next, { timeout: 100, maxEditLength: 2000 });
  if (!parts) return { additions: null, deletions: null, rows: [], limited: true };
  let left = 0, right = 0;
  const rows = parts.flatMap(part => {
    const content = part.value.split('\n'); if (content.at(-1) === '') content.pop();
    return content.map(text => ({ type: part.added ? 'add' as const : part.removed ? 'remove' as const : 'same' as const, text, oldLine: part.added ? null : ++left, newLine: part.removed ? null : ++right }));
  });
  return { additions: rows.filter(row => row.type === 'add').length, deletions: rows.filter(row => row.type === 'remove').length, rows, limited: false };
}
