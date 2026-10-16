import { randomUUID } from 'node:crypto';
import type { GitItem } from '../../contracts/workbench';
import type { ReviewBlock } from '../../contracts/review-task';
import { parseDiff, type DiffLine } from '../../shared/lib/pr-diff';
export type ReviewFile = NonNullable<GitItem['files']>[number];
export const MAX_REVIEW_BLOCKS = 32;
const BLOCK_SIZE = 5500;
function fragment(rows: DiffLine[]) {
  const old = rows.filter(r => r.oldLine !== undefined), current = rows.filter(r => r.newLine !== undefined);
  return `@@ -${old[0]?.oldLine ?? 0},${old.length} +${current[0]?.newLine ?? 0},${current.length} @@\n${rows.map(r => r.text).join('\n')}`;
}
export function planReview(files: ReviewFile[]) {
  const blocks: ReviewBlock[] = [], fragments: Record<string, ReviewFile> = {}; let used = 0;
  for (const file of files) {
    const parts: string[] = []; let rows: DiffLine[] = [], size = 0, omitted = false;
    const flush = () => { if (rows.length) parts.push(fragment(rows)); rows = []; size = 0; };
    for (const row of parseDiff(file.patch || '')) {
      if (row.kind === 'hunk') { flush(); continue; }
      if (row.kind === 'meta') continue;
      if (row.text.length > BLOCK_SIZE - 100) { flush(); omitted = true; continue; }
      if (size + row.text.length > BLOCK_SIZE - 100) flush();
      rows.push(row); size += row.text.length + 1;
    }
    flush(); const packed: string[] = [];
    for (const part of parts) { const last = packed.length - 1; if (last >= 0 && packed[last].length + part.length + 1 <= BLOCK_SIZE) packed[last] += `\n${part}`; else packed.push(part); }
    for (const [index, patch] of packed.entries()) {
      const id = randomUUID(), eligible = used < MAX_REVIEW_BLOCKS;
      blocks.push({ id, path: file.path, part: index + 1, attempts: 0, status: eligible ? 'pending' : 'skipped', reason: eligible ? undefined : '超出单次 32 块预算；请缩小 PR 或人工核对未审部分。' });
      if (eligible) { fragments[id] = { ...file, patch, patchTruncated: true }; used++; }
    }
    if (!packed.length || file.patchTruncated || omitted) blocks.push({ id: randomUUID(), path: file.path, part: packed.length + 1, attempts: 0, status: 'skipped', reason: !file.patch ? 'GitHub 未提供文本 Diff，可能为二进制或过大文件。' : omitted ? '存在超长单行，未送入模型。' : file.patchTruncated ? 'GitHub 或采集预算截断，此文件还有未读取部分。' : '没有可解释的有效 Diff 行。' });
  }
  return { blocks, fragments };
}
