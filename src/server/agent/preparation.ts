import type { ClaimedTask } from './store';
import { getReproductionJob } from '../workbench/store';
import { activePolicy } from '../workbench/policy';
import { verificationHash } from '../workbench/maintenance-verification';
import { dependencyCommand } from '../../../reproduction/commands.mjs';

/** Resolve fixed-source preflight options into proposed commands, never execution. */
export function preparationFromPreflight(claim: ClaimedTask, sourceJobId: string, optionIds: string[]) {
  const { task, owner } = claim;
  if (!task.artifacts.some(a => a.kind === 'verification' && a.jobIds?.includes(sourceJobId))) throw new Error('准备来源不属于当前任务的需求对照。');
  const source = getReproductionJob(owner, sourceJobId);
  const item = JSON.parse(claim.internal.cache.item || '{}');
  const revision = task.kind === 'pr' ? item.baseSha : task.commitSha;
  if (source.repoUrl !== task.repoUrl || source.agentTaskId !== task.id || source.commitSha !== revision || !source.verification
    || source.verification.policyRevision !== (activePolicy(owner, task.repoUrl)?.revision || 0)
    || source.plan.workingDirectory && source.plan.workingDirectory !== '.') throw new Error('准备来源的固定版本、规则或执行目录已变化。');
  if (source.verification.baseSha !== revision || task.kind === 'pr' && source.verification.headSha !== task.commitSha
    || verificationHash(source.plan) !== (source.verificationRole === 'baseline' ? source.verification.planHash : source.verification.patchedPlanHash)) throw new Error('准备来源计划指纹或对照版本不匹配。');
  const check = source.preflightJobId ? getReproductionJob(owner, source.preflightJobId) : undefined;
  const report = check?.preflight;
  if (!check || check.purpose !== 'environment-preflight' || check.preflightForJobId !== source.id || !['reproduced', 'blocked'].includes(check.status)
    || !report || report.commitSha !== revision || report.planHash !== verificationHash(source.plan)
    || !Number.isFinite(Date.parse(report.checkedAt)) || Date.parse(report.checkedAt) > Date.now() + 60000 || Date.now() - Date.parse(report.checkedAt) > 30 * 60000) throw new Error('准备来源预检缺失、已过期或指纹不匹配，请重新预检。');
  if (!optionIds.length || optionIds.length > 4 || new Set(optionIds).size !== optionIds.length) throw new Error('请选择至多四个不重复的准备选项。');
  const commands = optionIds.map(id => {
    const option = report.preparationOptions?.find(option => option.id === id);
    const prefix = 'python3 -m pip install --target .repocare-python --no-compile ';
    const match = id.match(/^(group|extra):([A-Za-z0-9][A-Za-z0-9_-]{0,39})$/);
    const requirements = id.match(/^requirements:(requirements(?:-(?:dev|test))?\.txt)$/);
    const tail = id === 'project' ? '--no-build-isolation .' : match ? match[1] === 'group' ? `--group ${match[2]}` : `--no-build-isolation .[${match[2]}]` : requirements ? `-r ${requirements[1]}` : undefined;
    if (!option || !tail || option.path !== (requirements ? requirements[1] : 'pyproject.toml') || option.command !== prefix + tail || !dependencyCommand(option.command)) throw new Error('准备选项不在当前预检的受支持声明中。');
    return option.command;
  });
  return { commands, preflightId: check.id, revision, optionIds };
}
