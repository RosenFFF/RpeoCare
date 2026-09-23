import { GitBranch, LoaderCircle, Square } from 'lucide-react';

export function AuditProgress({ repository, branch, stopping, disabled, onCancel }: {
  repository: string;
  branch: string;
  stopping: boolean;
  disabled: boolean;
  onCancel: () => void;
}) {
  return <div className="as-active-composer">
    <div className="as-active-details">
      <p className="as-active-status" role="status"><LoaderCircle size={14} className="aw-spin" aria-hidden="true" />{stopping ? '正在停止体检' : '正在体检'}</p>
      <strong className="as-active-repository">{repository}</strong>
      <div className="as-active-meta"><span><GitBranch size={13} aria-hidden="true" />{branch}</span><p>{stopping ? '正在结束当前步骤，请稍候。' : '任务执行中，仓库地址已锁定。'}</p></div>
    </div>
    <button type="button" className="as-cancel" disabled={disabled || stopping} onClick={onCancel}><Square size={14} aria-hidden="true" />{stopping ? '正在停止…' : '停止体检'}</button>
  </div>;
}
