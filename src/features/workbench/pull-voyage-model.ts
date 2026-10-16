import type { GitItem } from '@/contracts/workbench';

export function pullIdentity(item: GitItem) {
  const review = item.reviewSnapshot;
  return JSON.stringify([item.url, item.headSha, item.baseSha, item.updatedAt, review?.state, review?.analyzedAt, review?.openFindingCount, review?.acceptedFindingCount]);
}

export function pullCheckSignal(item: GitItem, live = false) {
  const checks = item.reviewSnapshot?.state === 'stale' && !live ? [] : item.checks ?? [];
  const failed = checks.filter(check => check.status === 'completed' && check.conclusion && !['success', 'neutral', 'skipped'].includes(check.conclusion)).length;
  const running = checks.filter(check => check.status === 'queued' || check.status === 'in_progress').length;
  const unknown = checks.filter(check => check.status === 'unknown' || (check.status === 'completed' && !check.conclusion)).length;
  const completed = checks.length - failed - running - unknown;
  const complete = item.checksAvailable === true;
  if (failed) return { tone: 'failed' as const, label: `${failed} 项未通过`, failed, running, unknown, completed, total: checks.length, complete };
  if (running) return { tone: 'pending' as const, label: `${running} 项进行中`, failed, running, unknown, completed, total: checks.length, complete };
  if (!checks.length || unknown || !complete) return { tone: 'unknown' as const, label: !checks.length ? complete ? '未发现检查' : '检查待读取' : unknown ? `${unknown} 项结论未知` : `${completed} 项完成，清单待确认`, failed, running, unknown, completed, total: checks.length, complete };
  return { tone: 'passed' as const, label: `${completed} 项可见检查完成`, failed, running, unknown, completed, total: checks.length, complete };
}

export function pullChangeSignal(item: GitItem) {
  const files = item.files;
  return {
    read: files !== undefined,
    count: files?.length ?? 0,
    total: item.totalChangedFiles,
    partial: Boolean(item.filesTruncated),
    additions: files?.reduce((sum, file) => sum + Math.max(0, file.additions || 0), 0) ?? 0,
    deletions: files?.reduce((sum, file) => sum + Math.max(0, file.deletions || 0), 0) ?? 0,
  };
}

export function pullReviewSignal(item: GitItem) {
  if (item.reviewSnapshot?.state === 'stale') return { tone: 'stale' as const, label: '审查已过期', open: 0 };
  if (!item.reviewSnapshot) return { tone: 'unread' as const, label: '尚未审查', open: 0 };
  const scope = item.reviewSnapshot;
  if (scope.coverageStatus === 'queued' || scope.coverageStatus === 'running') return { tone: 'unread' as const, label: `审查中 ${scope.completedBlocks ?? 0}/${scope.totalBlocks ?? '?'}`, open: scope.openFindingCount };
  if (scope.coverageStatus === 'partial' || scope.coverageStatus === 'cancelled') return { tone: 'unread' as const, label: `部分审查 ${scope.completedBlocks ?? 0}/${scope.totalBlocks ?? '?'}`, open: scope.openFindingCount };
  return { tone: 'reviewed' as const, label: item.reviewSnapshot.openFindingCount ? `${item.reviewSnapshot.openFindingCount} 条待确认` : '已有审查报告', open: item.reviewSnapshot.openFindingCount };
}

export function commitTexture(sha?: string) {
  return sha && /^[a-f\d]{40}$/i.test(sha) ? [...sha.slice(0, 16)].map(hex => parseInt(hex, 16)) : [];
}
