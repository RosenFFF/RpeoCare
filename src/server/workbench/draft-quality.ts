import type { Draft } from '../../contracts/workbench';
import type { DraftQualityContext } from '../../shared/lib/draft-quality';
import { inspectDraft } from '../../shared/lib/draft-quality';
import { getRun } from '../audit/store';
import { getSnapshot } from './store';
export function qualityContext(owner: string, draft: Draft): DraftQualityContext | undefined {
  if (!draft.runId) return;
  const run = getRun(draft.runId, owner);
  if (!run || run.repoUrl !== draft.repoUrl || run.repository?.sha !== draft.baseSha) return;
  const snapshot = getSnapshot(draft.runId); if (!snapshot) return;
  const pkg = snapshot.contents.find(file => file.path === 'package.json' && !file.error && !file.truncated);
  let scripts: string[] = [], scriptsKnown = false;
  if (pkg) { try { const value = JSON.parse(pkg.content); if (value && typeof value === 'object' && !Array.isArray(value) && (value.scripts === undefined || value.scripts && typeof value.scripts === 'object' && !Array.isArray(value.scripts))) { scripts = Object.entries(value.scripts || {}).filter(([,command]) => typeof command === 'string').map(([name]) => name); scriptsKnown = true; } } catch { /* Unknown is not absence. */ } }
  return { paths: snapshot.files.slice(0, 10000).map(file => file.path), pathsComplete: !snapshot.treeTruncated && snapshot.files.length <= 10000, scripts, scriptsKnown };
}
export function assertDraftQuality(owner: string, draft: Draft) {
  if (inspectDraft(draft.content, draft.before, draft.path, qualityContext(owner, draft)).some(item => item.level === 'blocker')) throw new Error('草稿内容存在阻断项，请先检查内容校验结果。');
}
