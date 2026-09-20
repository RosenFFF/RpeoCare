'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Check, CheckCircle2, ChevronDown, CircleDashed, FileText, GitBranch, Info, RefreshCw, ShieldCheck } from 'lucide-react';
import './maintenance-views.css';

type Category = '文档' | '协作' | '工程';
type AuditCheck = { id: string; category: Category; title: string; summary: string; passed: boolean; path: string; evidence: string; suggestion: string; draftId?: string };

const checks: AuditCheck[] = [
  { id: 'contributing', category: '文档', title: '贡献指南', summary: '尚未说明本地开发与提交变更的流程', passed: false, path: 'CONTRIBUTING.md', evidence: '演示文件清单中未找到 CONTRIBUTING.md；README 只有安装和使用说明。', suggestion: '补充环境准备、运行测试、分支命名与 PR 提交步骤。可在「规范改进」中审阅对应草稿。', draftId: 'contributing' },
  { id: 'issue-template', category: '协作', title: 'Bug 反馈模板', summary: '平台尚未提供收集环境、复现步骤与实际行为的表单', passed: false, path: '.github/ISSUE_TEMPLATE/', evidence: '演示快照中该目录为空，尚未配置 GitHub Issue Form。Issue 分诊引用的是独立的 .openbridge/rules.yml 演示规则；分诊规则存在，不代表平台反馈模板已经安装。', suggestion: '依据现有分诊规则补充 GitHub Issue Form，收集版本、操作系统、复现步骤、期望行为和错误日志。', draftId: 'bug-template' },
  { id: 'pr-template', category: '协作', title: 'Pull Request 模板', summary: '现有模板缺少关联问题与提交前检查清单', passed: false, path: '.github/PULL_REQUEST_TEMPLATE.md', evidence: '演示模板仅包含「变更说明」段落，关联 Issue、测试结果与文档更新均未被约定。', suggestion: '增加关联 Issue、变更摘要、验证方式和文档更新检查项。模板提示不替代维护者审核。', draftId: 'pr-template' },
  { id: 'ci', category: '工程', title: '持续集成配置', summary: '测试尚未接入自动化工作流', passed: false, path: '.github/workflows/', evidence: '演示快照包含 tests/ 和 pytest 配置，但不包含 GitHub Actions 工作流。', suggestion: '先在已知环境验证安装与测试命令，再由维护者选择是否添加 CI。演示不会执行仓库脚本。' },
  { id: 'readme', category: '文档', title: '项目介绍与快速开始', summary: 'README 包含用途、安装和最小使用示例', passed: true, path: 'README.md:1–48', evidence: '演示文档包含「About」「Installation」「Quick start」三个段落，以及 CSV 读取示例。', suggestion: '定期将示例与当前版本比对；本项通过仅表示结构存在，不代表示例已在真实环境执行。' },
  { id: 'installation', category: '文档', title: '运行环境说明', summary: '明确 Python 版本与安装命令', passed: true, path: 'pyproject.toml:8 / README.md:14', evidence: '演示配置声明 requires-python = ">=3.10"，安装说明与包名 csv-kit 一致。', suggestion: '发布前在干净环境复核安装过程，并记录实际支持的 Python 版本。' },
  { id: 'license', category: '文档', title: '许可证文件', summary: '仓库根目录包含许可证声明', passed: true, path: 'LICENSE', evidence: '演示文件清单包含 MIT 许可证文本。本检查只验证文件存在和声明，不构成法律兼容性意见。', suggestion: '由项目权利人确认授权范围；新增第三方代码时独立核对其许可要求。' },
  { id: 'labels', category: '协作', title: 'Issue 标签约定', summary: '问题类型、复现信息与讨论状态标签已定义', passed: true, path: '.openbridge/rules.yml', evidence: '预置分诊规则声明 bug、enhancement、needs-reproduction、needs-discussion、question、installation 六类标签，与 Issue 工作台一致。该规则文件独立于尚未补齐的 GitHub Issue 表单。', suggestion: '保持分诊规则中的标签与平台实际标签同步；新标签发布前由维护者确认。' },
  { id: 'conduct', category: '协作', title: '社区沟通约定', summary: '包含友善交流和问题反馈的基本约定', passed: true, path: 'CODE_OF_CONDUCT.md', evidence: '演示文档包含参与者行为约定与反馈方式。', suggestion: '确保反馈方式由项目管理员确认，避免生成不存在的联系方式。' },
  { id: 'tests', category: '工程', title: '测试入口', summary: '存在测试目录和 pytest 配置', passed: true, path: 'tests/ / pyproject.toml:28', evidence: '演示文件清单包含 test_reader.py、test_writer.py，配置指定 testpaths = ["tests"]。', suggestion: '本项不等于测试通过或覆盖充分；实际接入后应在受控环境中执行测试并记录结果。' },
  { id: 'lint', category: '工程', title: '代码检查配置', summary: 'Ruff 规则与行宽已明确', passed: true, path: 'pyproject.toml:35', evidence: '演示配置包含 [tool.ruff] 和 lint.select 字段，文档给出 ruff check . 命令。', suggestion: '后续可将同一命令接入 CI，减少本地与远程检查结果的差异。' },
  { id: 'typing', category: '工程', title: '类型检查约定', summary: '明确类型检查工具及检查范围', passed: true, path: 'pyproject.toml:42', evidence: '演示配置包含 [tool.mypy]，检查目录指定为 src/csv_kit。', suggestion: '先确认现有代码检查结果，再决定是否将类型检查设置为合并前必须通过。' },
];

const filters = ['全部', '文档', '协作', '工程'] as const;

export function AuditView({ onNotify }: { onNotify: (message: string) => void }) {
  const [filter, setFilter] = useState<(typeof filters)[number]>('全部');
  const [expanded, setExpanded] = useState<string | null>('contributing');
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState('尚未重新检查');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const visibleChecks = checks.filter((item) => filter === '全部' || item.category === filter);

  function recheck() {
    if (checking) return;
    setChecking(true);
    timer.current = setTimeout(() => {
      setChecking(false);
      setLastChecked(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
      onNotify('演示检查已刷新：8 项通过，4 项待完善。未扫描真实仓库。');
    }, 850);
  }

  return (
    <div className="mv-page">
      <div className="page-heading mv-heading">
        <div><span className="eyebrow">PROJECT AUDIT</span><h1>让项目更容易被维护。</h1><p>从项目约定开始，发现缺口，审阅依据，再决定下一步。</p></div>
        <button className="button button-secondary mv-recheck" onClick={recheck} disabled={checking} aria-busy={checking}><RefreshCw size={15} className={checking ? 'mv-spin' : ''} />{checking ? '正在检查演示数据…' : '重新检查'}</button>
      </div>

      <div className="mv-demo-note"><Info size={15} aria-hidden="true" /><span><strong>交互演示</strong> · CSV-kit 为虚构仓库。以下结果来自预置规则与文件快照，未连接或扫描真实项目。</span></div>

      <section className="mv-audit-summary" aria-labelledby="mv-audit-summary-title">
        <div className="mv-audit-summary-main">
          <div className="mv-label"><ShieldCheck size={16} aria-hidden="true" /><span id="mv-audit-summary-title">维护检查概览</span><span className="chip mv-muted-chip">12 条规则</span></div>
          <div className="mv-score-line"><span className="mv-score">8<span>/ 12</span></span><div><strong>检查通过</strong><p>4 项待完善，先从贡献指南开始。</p></div></div>
          <div className="mv-segments" aria-hidden="true">{checks.map((item, index) => <span key={item.id} className={index < 8 ? 'mv-segment-passed' : ''} />)}</div>
          <p className="mv-score-caption">规则检查结果，不是项目质量评分。</p>
        </div>
        <div className="mv-audit-breakdown">
          {(['文档', '协作', '工程'] as Category[]).map((category) => {
            const categoryChecks = checks.filter((check) => check.category === category);
            const passed = categoryChecks.filter((check) => check.passed).length;
            return <div className="mv-breakdown-row" key={category}><span>{category}基础</span><div className="mv-mini-progress" aria-hidden="true"><span style={{ width: `${passed / categoryChecks.length * 100}%` }} /></div><strong>{passed}<span> / {categoryChecks.length}</span></strong></div>;
          })}
          <div className="mv-report-meta"><GitBranch size={13} aria-hidden="true" /><span>CSV-kit / main · 演示快照</span></div>
          <p className="mv-report-time" role="status" aria-live="polite">{checking ? '正在重新核对预置规则…' : `本地演示刷新：${lastChecked}`}</p>
        </div>
      </section>

      <div className="mv-section-title"><div><h2>维护检查清单</h2><p>展开任一检查，查看证据与改进建议。</p></div><span className="mv-small-meta">优先展示待完善项 <ArrowDownRight size={14} aria-hidden="true" /></span></div>
      <div className="mv-filter-row" aria-label="按检查类别筛选">{filters.map((item) => <button key={item} className={`mv-filter ${filter === item ? 'mv-filter-active' : ''}`} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}<span>{item === '全部' ? checks.length : checks.filter((check) => check.category === item).length}</span></button>)}</div>

      <div className="mv-check-list">
        <div className="mv-list-head" aria-hidden="true"><span>检查项目</span><span>状态</span><span /></div>
        {visibleChecks.map((item) => {
          const open = expanded === item.id;
          return <article className={`mv-check ${open ? 'mv-check-open' : ''}`} key={item.id}>
            <button type="button" className="mv-check-trigger" aria-expanded={open} aria-controls={`mv-check-detail-${item.id}`} onClick={() => setExpanded(open ? null : item.id)}>
              <span className="mv-check-name"><span className={`mv-check-symbol ${item.passed ? 'mv-passed' : 'mv-pending'}`}>{item.passed ? <Check size={15} aria-hidden="true" /> : <CircleDashed size={16} aria-hidden="true" />}</span><span><strong>{item.title}</strong><span className="mv-check-summary">{item.summary}</span></span></span>
              <span className={`mv-check-status ${item.passed ? 'mv-status-passed' : 'mv-status-pending'}`}>{item.passed ? '已通过' : '待完善'}</span>
              <ChevronDown size={16} className={open ? 'mv-chevron-open' : ''} aria-hidden="true" />
            </button>
            {open && <div id={`mv-check-detail-${item.id}`} className="mv-check-detail"><div><span className="mv-detail-label"><FileText size={13} aria-hidden="true" />规则依据</span><code>{item.path}</code><p>{item.evidence}</p></div><div><span className="mv-detail-label"><ArrowUpRight size={14} aria-hidden="true" />改进建议</span><p>{item.suggestion}</p>{item.draftId && <Link className="mv-draft-link" href={`/improvements?draft=${item.draftId}`}>审阅对应草稿<ArrowUpRight size={14} aria-hidden="true" /></Link>}</div></div>}
          </article>;
        })}
      </div>
      <div className="mv-bottom-note"><CheckCircle2 size={15} aria-hidden="true" /><p>检查透明，决定由你。每项结论都保留依据；应用任何改动前，应在真实仓库中重新验证。</p></div>
    </div>
  );
}
