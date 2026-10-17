import type { AgentPatchFile } from '../../contracts/agent';
import { repositoryPath } from './repository';

export interface PatchEdit { path: string; before: string; after: string }
interface PatchReader { file(path: string): Promise<{ content: string }>; tree(): Promise<{ tree: { path: string }[]; truncated: boolean; occupied?: string[]; blockedParents?: string[] }> }

/** Candidate edits retain original before bytes for review and paired execution. */
export async function preparePatchRevision(edits: PatchEdit[], previous: AgentPatchFile[], reader: PatchReader, wasRead: (path: string) => boolean) {
  const tree = await reader.tree();
  const candidateReader: PatchReader = {
    tree: async () => ({ ...tree, tree: [...tree.tree, ...previous.filter(file => !tree.tree.some(entry => entry.path === file.path)).map(file => ({ path: file.path }))] }),
    file: async path => { const file = previous.find(file => file.path === path); return file ? { content: file.after } : reader.file(path); },
  };
  const changes = await preparePatchFiles(edits, candidateReader, path => previous.some(file => file.path === path) || wasRead(path));
  return changes.map(change => {
    const original = previous.find(file => file.path === change.path);
    if (!original) return change;
    if (change.after === original.before) throw new Error('修订撤销了整个文件的改动，请显式重新准备完整候选。');
    return { ...change, before: original.before, created: original.created };
  });
}

/** Keep untouched candidate files when a later stage adds tests; touched files are rebuilt from the original. */
export function combinePatchFiles(previous: AgentPatchFile[], changes: AgentPatchFile[], replaceAll = false) {
  const paths = new Set(changes.map(file => file.path));
  for (const changed of changes) {
    const old = previous.find(file => file.path === changed.path);
    if (old && old.before !== changed.before) throw new Error('两版文件基准不同，请重新读取固定提交。');
  }
  const files = [...(replaceAll ? [] : previous.filter(file => !paths.has(file.path))), ...changes].sort((a, b) => a.path.localeCompare(b.path));
  if (files.length > 4) throw new Error('完整候选补丁最多四个文件；需要移除旧文件时显式 replaceAll 并提交完整方案。');
  return files;
}

/** Apply exact non-overlapping edits against the original blob, never against another candidate. */
export async function preparePatchFiles(edits: PatchEdit[], reader: PatchReader, wasRead: (path: string) => boolean): Promise<AgentPatchFile[]> {
  const paths = [...new Set(edits.map(edit => repositoryPath(edit.path)))];
  if (!edits.length || edits.length > 12 || paths.length > 4) throw new Error('补丁最多四个文件、十二处修改。');
  const files: AgentPatchFile[] = [];
  for (const path of paths) {
    const changes = edits.filter(edit => edit.path === path);
    if (changes.some(edit => !edit.before)) {
      if (changes.length !== 1 || !changes[0].after.trim()) throw new Error('新增或空文件必须使用一次完整写入。');
      const tree = await reader.tree(), existing = tree.tree.some(file => file.path === path);
      if (existing) {
        const source = await reader.file(path);
        if (source.content !== '' || !wasRead(path)) throw new Error('请先读取目标文件，并使用唯一原文作为 before。');
      } else if (tree.truncated || tree.occupied?.includes(path) || tree.blockedParents?.some(parent => path.startsWith(parent + '/'))) {
        throw new Error('新增路径未确认可用，或穿过符号链接/子模块。');
      }
      if (changes[0].after.length > 20000) throw new Error('替换文件超过 20,000 字符。');
      files.push({ path, before: '', after: changes[0].after, created: !existing });
      continue;
    }
    if (!wasRead(path)) throw new Error('请先 read_file 读取目标文件。');
    const source = await reader.file(path);
    if (source.content.length > 20000) throw new Error('文件超过补丁边界。');
    const ranges = changes.map(edit => {
      const start = source.content.indexOf(edit.before);
      if (start < 0 || source.content.indexOf(edit.before, start + 1) >= 0) throw new Error(`替换原文必须在原始文件中唯一匹配：${path}。请重读准确片段，不使用占位文本。`);
      return { ...edit, start, end: start + edit.before.length };
    }).sort((a, b) => a.start - b.start);
    if (ranges.some((range, index) => index > 0 && range.start < ranges[index - 1].end)) throw new Error('同一文件的修改片段不能重叠。');
    let after = source.content;
    for (const range of ranges.toReversed()) after = after.slice(0, range.start) + range.after + after.slice(range.end);
    if (after === source.content || after.length > 20000) throw new Error('补丁无变化或替换文件过长。');
    files.push({ path, before: source.content, after });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
