import { getRepository, collectRepository } from './github';
import { runRules } from './rules';
import { analyzeWithAgent } from './agent';
import { getRun, getRunConnection, updateRun } from './store';
import { isTerminal, type AuditNode, type AuditReport, type CheckResult, type NodeId } from '../../contracts/audit';

export async function executeRun(id: string, shutdown?: AbortSignal) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  shutdown?.addEventListener('abort', cancel, { once: true });
  if (shutdown?.aborted) controller.abort();
  const deadline = setTimeout(() => controller.abort(new Error('体检超时，请稍后重新体检。')), 240_000);
  const cancellationPoll = setInterval(() => {
    if (getRun(id)?.cancelRequested) controller.abort();
  }, 250);
  let current: NodeId = 'repository';
  const guard = () => {
    controller.signal.throwIfAborted();
    const run = getRun(id);
    if (!run || run.cancelRequested || isTerminal(run.status)) throw new Error('任务已停止。');
  };
  const node = (nodeId: NodeId, patch: Partial<AuditNode>) => {
    guard();
    updateRun(id, run => {
      if (isTerminal(run.status)) return;
      Object.assign(run.nodes.find(item => item.id === nodeId)!, patch);
    });
  };
  const start = (nodeId: NodeId, message: string) => {
    current = nodeId;
    node(nodeId, { status: 'running', message, startedAt: new Date().toISOString() });
  };
  const done = (nodeId: NodeId, message: string) => node(nodeId, { status: 'succeeded', message, finishedAt: new Date().toISOString() });
  try {
    guard();
    start('repository', '正在读取公开仓库信息与默认分支');
    const repository = await getRepository(getRun(id)!.repoUrl, controller.signal);
    guard();
    updateRun(id, run => { if (!isTerminal(run.status)) run.repository = repository; });
    done('repository', `已锁定 ${repository.fullName} · ${repository.sha.slice(0, 7)}`);

    start('collect', '正在读取目录和维护相关文件');
    const snapshot = await collectRepository(repository, controller.signal, (message, completed, total) => {
      node('collect', { message, completed, total });
    });
    node('collect', { evidence: snapshot.contents.map(file => ({
      path: file.path, note: file.error || (file.truncated ? '已截取部分内容' : '已读取'),
      url: `${repository.url}/blob/${repository.sha}/${file.path.split('/').map(encodeURIComponent).join('/')}`,
    })) });
    done('collect', `已读取 ${snapshot.contents.filter(file => !file.error).length} 份文件，目录包含 ${snapshot.files.length} 个文件`);

    start('rules', '核对文档、协作入口与工程配置');
    const checks: CheckResult[] = runRules(snapshot);
    node('rules', { completed: checks.length, total: checks.length, evidence: checks.flatMap(check => check.evidence).slice(0, 20) });
    done('rules', `已完成 ${checks.length} 项规则检查`);

    let agentStatus: AuditReport['agentStatus'] = 'disabled';
    if (getRun(id)?.model) {
      start('agent', 'Agent 正在对照文件内容与工程配置');
      try {
        const connection = getRunConnection(id);
        const findings = await analyzeWithAgent(snapshot, controller.signal, message => node('agent', { message }), connection, event => {
          guard();
          updateRun(id, run => {
            if (isTerminal(run.status)) return;
            const events = run.agentEvents ??= [];
            if (events.length < 64) events.push({ ...event, at: new Date().toISOString(), index: events.length + 1 });
          });
        });
        guard();
        checks.push(...findings);
        agentStatus = 'completed';
        node('agent', { evidence: findings.flatMap(check => check.evidence) });
        done('agent', `内容分析完成，已核验 ${findings.length} 项结论的文件引用`);
      } catch (error) {
        guard();
        agentStatus = 'failed';
        const message = error instanceof Error ? error.message : 'Agent 分析未完成。';
        snapshot.warnings.push(`AI 分析未完成：${message} 已保留规则检查结果。`);
        node('agent', { status: 'failed', message, finishedAt: new Date().toISOString() });
      }
    } else {
      node('agent', { status: 'skipped', message: '未配置模型，本次仅运行真实规则检查', finishedAt: new Date().toISOString() });
    }

    start('report', '正在汇总检查结论与引用');
    const report: AuditReport = {
      runId: id, repository, generatedAt: new Date().toISOString(), checks,
      warnings: snapshot.warnings, agentStatus,
      model: getRun(id)?.model,
      scope: '公开仓库默认分支的固定提交快照；维护文档与配置检查，不执行仓库代码，不代表测试通过或代码安全审计。',
    };
    guard();
    updateRun(id, run => {
      if (isTerminal(run.status)) return;
      Object.assign(run.nodes.find(item => item.id === 'report')!, {
        status: 'succeeded', message: '报告已保存，可查看依据或导出', finishedAt: new Date().toISOString(),
      });
      run.report = report;
      run.status = 'completed';
    });
  } catch (error) {
    const run = getRun(id);
    if (run && !isTerminal(run.status)) {
      const message = shutdown?.aborted ? '后台执行已停止。已有记录已保留，可重新体检。'
        : controller.signal.aborted ? '体检超时或执行已中断，请重新体检。'
        : error instanceof Error ? error.message : '体检未能完成，请重试。';
      updateRun(id, state => {
        if (isTerminal(state.status)) return;
        state.status = 'failed'; state.error = message;
        state.nodes.forEach(item => {
          if (item.id === current && item.status === 'running') {
            item.status = 'failed'; item.message = message; item.finishedAt = new Date().toISOString();
          } else if (item.status === 'pending') { item.status = 'skipped'; item.message = '上游步骤未完成'; }
        });
      });
    }
  } finally {
    clearTimeout(deadline); clearInterval(cancellationPoll);
    shutdown?.removeEventListener('abort', cancel);
  }
}
