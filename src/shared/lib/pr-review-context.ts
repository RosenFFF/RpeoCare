import { createHash } from 'node:crypto';
import type { GitItem, PullRequestReview } from '../../contracts/workbench';

export function prepareReviewFiles(files: NonNullable<GitItem['files']>) {
  let remaining = 45_000;
  return files.map(file => {
    const candidate = file.patch?.slice(0, Math.min(12_000, remaining));
    const shortened = !!file.patch && candidate?.length !== file.patch.length;
    const patch = shortened && candidate ? candidate.slice(0, Math.max(0, candidate.lastIndexOf('\n'))) : candidate;
    remaining -= patch?.length || 0;
    return { ...file, patch, patchTruncated: Boolean(file.patchTruncated || shortened || !patch) };
  });
}
export function reviewFingerprint(item: GitItem, files: NonNullable<GitItem['files']>) {
  return createHash('sha256').update(JSON.stringify({ head: item.headSha, base: item.baseSha, title: item.title, body: item.body, files })).digest('hex');
}
export function reviewSourceFingerprint(item: GitItem) {
  return createHash('sha256').update(JSON.stringify({ head: item.headSha, base: item.baseSha, title: item.title, body: item.body, updatedAt: item.updatedAt, total: item.totalChangedFiles, truncated: item.filesTruncated, files: item.files })).digest('hex');
}
export function isReviewCurrent(review: PullRequestReview, item: GitItem) {
  return review.headSha === item.headSha && review.baseSha === item.baseSha && (review.snapshotFingerprint ? review.snapshotFingerprint === reviewSourceFingerprint(item) : review.contextFingerprint === reviewFingerprint(item, prepareReviewFiles(item.files || [])));
}
