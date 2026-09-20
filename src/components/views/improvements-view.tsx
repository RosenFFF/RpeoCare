'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, CheckCircle2, ChevronRight, Download, FileCode2, FileText, GitPullRequest, Info, RotateCcw, Sparkles } from 'lucide-react';
import './maintenance-views.css';

type Draft = { id: string; name: string; path: string; title: string; summary: string; reason: string; content: string; oldContent: string; icon: 'text' | 'code' | 'pr' };

const drafts: Draft[] = [
  {
    id: 'contributing', name: 'CONTRIBUTING.md', path: 'CONTRIBUTING.md', title: '让第一次贡献有章可循', summary: '明确环境准备、验证命令和提交规范。', reason: '项目体检发现缺少贡献指南。草稿根据 CSV-kit 演示目录和命令生成，使用前请核对项目实际约定。', oldContent: '', icon: 'text',
    content: '# 参与 CSV-kit\n\n感谢你帮助改进 CSV-kit。提交变更前，请先阅读以下约定。\n\n## 准备开发环境\n\n本示例使用 Python 3.10 或更新版本。\n\n```bash\npython -m venv .venv\npython -m pip install -e ".[dev]"\n```\n\n请根据操作系统激活虚拟环境，再安装开发依赖。\n\n## 提交变更\n\n1. 创建独立分支，保持一次变更聚焦一个问题。\n2. 修复问题时，补充能够描述问题行为的测试。\n3. 如改变公开接口，请同步更新使用文档。\n\n## 本地验证\n\n```bash\npython -m pytest\nruff check .\n```\n\n## 创建 Pull Request\n\n说明变更目的、关联 Issue、验证结果与尚未覆盖的情况。\n请等待维护者审核后再合并。\n\n> 本文件为演示草稿，命令与依赖需在真实项目中确认。\n',
  },
  {
    id: 'bug-template', name: 'bug_report.yml', path: '.github/ISSUE_TEMPLATE/bug_report.yml', title: '在反馈入口收集必要信息', summary: '把版本、复现过程和错误信息变成明确字段。', reason: '分诊使用的 .openbridge/rules.yml 演示规则已定义信息要求，但仓库尚未安装 GitHub Issue 表单。此草稿把要求带到反馈入口；收集信息不等于确认 Bug。', oldContent: '', icon: 'code',
    content: 'name: Bug report\ndescription: 报告一个可以复现的问题\ntitle: "[Bug] "\nbody:\n  - type: input\n    id: version\n    attributes:\n      label: CSV-kit 与 Python 版本\n      placeholder: "例如：CSV-kit 0.3.0，Python 3.11"\n    validations:\n      required: true\n  - type: input\n    id: environment\n    attributes:\n      label: 操作系统与环境\n      placeholder: "例如：Windows 11，本地虚拟环境"\n    validations:\n      required: true\n  - type: textarea\n    id: reproduction\n    attributes:\n      label: 最小复现步骤\n      description: 请提供最小代码或不含个人信息的示例数据。\n    validations:\n      required: true\n  - type: textarea\n    id: behavior\n    attributes:\n      label: 预期行为与实际行为\n    validations:\n      required: true\n  - type: textarea\n    id: logs\n    attributes:\n      label: 错误日志\n      description: 提交前请移除令牌、邮箱及其他敏感信息。\n      render: shell\n',
  },
  {
    id: 'pr-template', name: 'PR 模板', path: '.github/PULL_REQUEST_TEMPLATE.md', title: '让审核从清晰的上下文开始', summary: '补充关联问题、验证说明和提交前检查项。', reason: '演示中的 PR 说明只有变更摘要。扩展后的模板引导贡献者提供验证结果，最终是否接受由维护者判断。', oldContent: '## 变更说明\n\n请简要描述你的修改。\n', icon: 'pr',
    content: '## 变更目的\n\n说明这个 PR 解决的问题，以及选择此方案的原因。\n\n## 关联 Issue\n\n填写相关 Issue 编号；无关联时说明背景。\n\n## 变更范围\n\n- 主要修改：\n- 对现有行为的影响：\n\n## 验证方式\n\n列出实际执行的命令、结果和尚未覆盖的情况。\n\n## 提交前检查\n\n- [ ] 变更聚焦当前问题，无无关文件\n- [ ] 已运行项目约定的检查并填写结果\n- [ ] 行为变化已补充相应测试（或说明原因）\n- [ ] 相关文档已更新（或说明不适用）\n\n## 需要维护者关注的事项\n\n说明兼容性、依赖变更或其他待确认内容。\n',
  },
];

function lines(content: string) { return content.trimEnd().split('\n'); }
const acceptedStorageKey = 'openbridge.improvements.v1';

export function ImprovementsView({ onNotify }: { onNotify: (message: string) => void }) {
  const [selectedId, setSelectedId] = useState(drafts[0].id);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [storageAvailable, setStorageAvailable] = useState(true);
  useEffect(() => {
    function readSelection() {
      const requested = new URLSearchParams(window.location.search).get('draft');
      setSelectedId(drafts.some((item) => item.id === requested) ? requested! : drafts[0].id);
    }
    readSelection();
    window.addEventListener('popstate', readSelection);
    try {
      const stored: unknown = JSON.parse(window.sessionStorage.getItem(acceptedStorageKey) ?? '[]');
      if (Array.isArray(stored)) setAccepted([...new Set(stored.filter((id): id is string => typeof id === 'string' && drafts.some((item) => item.id === id)))]);
    } catch { setStorageAvailable(false); }
    return () => window.removeEventListener('popstate', readSelection);
  }, []);
  const draft = drafts.find((item) => item.id === selectedId) ?? drafts[0];
  const isAccepted = accepted.includes(draft.id);
  const added = lines(draft.content);
  const removed = draft.oldContent ? lines(draft.oldContent) : [];

  function selectDraft(id: string) {
    setSelectedId(id);
    const url = new URL(window.location.href);
    url.searchParams.set('draft', id);
    window.history.pushState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function saveAccepted(next: string[]) {
    setAccepted(next);
    try {
      window.sessionStorage.setItem(acceptedStorageKey, JSON.stringify(next));
      window.dispatchEvent(new Event('openbridge-demo-change'));
      setStorageAvailable(true);
      return true;
    } catch {
      setStorageAvailable(false);
      return false;
    }
  }

  function acceptDraft() {
    const saved = saveAccepted(accepted.includes(draft.id) ? accepted : [...accepted, draft.id]);
    onNotify(saved ? `已在本次浏览器会话标记接受 ${draft.name}，未写入任何真实仓库。` : `已在当前页面接受 ${draft.name}；浏览器阻止了会话存储，刷新后不会保留。`);
  }

  function restoreDraft() {
    const saved = saveAccepted(accepted.filter((id) => id !== draft.id));
    onNotify(saved ? `已在本次浏览器会话恢复 ${draft.name} 为待审核草稿，未修改真实仓库。` : `已在当前页面恢复 ${draft.name}；浏览器阻止了会话存储，刷新后不会保留。`);
  }

  function downloadDraft() {
    const blob = new Blob([draft.content], { type: draft.name.endsWith('.yml') ? 'application/yaml;charset=utf-8' : 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = draft.path.split('/').pop() ?? draft.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onNotify(`已发起 ${draft.name} 下载。请按所示路径放入项目，并核对实际配置。`);
  }

  return (
    <div className="mv-page">
      <div className="page-heading mv-heading"><div><span className="eyebrow">PROJECT IMPROVEMENTS</span><h1>把维护约定，变成可审阅的改进。</h1><p>从缺失的指南与模板开始。逐项看清差异，再决定是否采用。</p></div><span className="chip mv-draft-count"><Sparkles size={13} aria-hidden="true" />3 份演示草稿</span></div>
      <div className="mv-demo-note"><Info size={15} aria-hidden="true" /><span><strong>交互演示</strong> · 所有草稿基于虚构的 CSV-kit。接受与恢复仅保存在本次浏览器会话，下载不会写入真实仓库。</span></div>
      {!storageAvailable && <p className="mv-storage-note" role="status">浏览器会话存储暂不可用，当前接受状态仅保留在此页面，刷新后不会保留。</p>}

      <div className="mv-improvements-layout">
        <aside className="mv-drafts-sidebar" aria-label="选择改进草稿">
          <div className="mv-sidebar-heading"><span>待审阅文件</span><span>{accepted.length} / 3 已接受</span></div>
          <div className="mv-draft-options">{drafts.map((item) => {
            const Icon = item.icon === 'code' ? FileCode2 : item.icon === 'pr' ? GitPullRequest : FileText;
            return <button key={item.id} type="button" className={`mv-draft-option ${selectedId === item.id ? 'mv-draft-option-active' : ''}`} aria-pressed={selectedId === item.id} onClick={() => selectDraft(item.id)}><Icon size={17} aria-hidden="true" /><span><strong>{item.name}</strong><span>{accepted.includes(item.id) ? '本次会话已接受' : item.oldContent ? '更新文件 · 待审核' : '新增文件 · 待审核'}</span></span>{accepted.includes(item.id) ? <CheckCircle2 size={15} className="mv-draft-accepted-icon" aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}</button>;
          })}</div>
          <div className="mv-sidebar-note"><span className="mv-detail-label"><ArrowUpRight size={14} aria-hidden="true" />建议审阅顺序</span><p>先确认开发与测试约定，再补齐 Issue 和 PR 模板。文件中的命令需要与你的项目一致。</p><span className="mv-sidebar-repo">CSV-kit / main <span>演示</span></span></div>
        </aside>

        <section className="mv-draft-workspace" aria-labelledby="mv-draft-title">
          <div className="mv-draft-intro"><div className="mv-draft-eyebrow"><span>{draft.oldContent ? '修改建议' : '新增建议'}</span><span>规范补全 / {drafts.findIndex((item) => item.id === selectedId) + 1} OF 3</span></div><h2 id="mv-draft-title">{draft.title}</h2><p>{draft.summary}</p><div className="mv-draft-reason"><span>为什么需要</span><p>{draft.reason}</p></div></div>

          <div className="mv-diff" role="region" aria-label={`${draft.name} 的差异预览`}>
            <div className="mv-diff-toolbar"><span><FileCode2 size={14} aria-hidden="true" /><code>{draft.path}</code></span><span className="mv-diff-count"><span>+{added.length}</span>{removed.length > 0 && <span>−{removed.length}</span>}</span></div>
            <div className="mv-diff-hunk">@@ {removed.length ? `-1,${removed.length}` : '-0,0'} +1,{added.length} @@ <span>{draft.oldContent ? '替换演示原文' : '新增文件'}</span></div>
            <div className="mv-diff-lines" tabIndex={0} role="region" aria-label="差异内容，可使用方向键滚动">{removed.map((line, index) => <div className="mv-diff-line mv-diff-line-removed" key={`removed-${draft.id}-${index}`}><span className="mv-line-number" aria-hidden="true">{index + 1}</span><span className="mv-line-mark" aria-label="删除">−</span><code>{line || ' '}</code></div>)}{added.map((line, index) => <div className="mv-diff-line mv-diff-line-added" key={`added-${draft.id}-${index}`}><span className="mv-line-number" aria-hidden="true">{index + 1}</span><span className="mv-line-mark" aria-label="新增">+</span><code>{line || ' '}</code></div>)}</div>
          </div>

          <div className="mv-draft-actions"><div className={`mv-accept-state ${isAccepted ? 'mv-accept-state-done' : ''}`} aria-live="polite">{isAccepted ? <CheckCircle2 size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}<span>{isAccepted ? storageAvailable ? '已接受 · 仅保存在本次浏览器会话' : '已接受 · 会话存储不可用，仅在当前页面保留' : '待你审核 · 尚未应用到任何仓库'}</span></div><div className="mv-action-buttons"><button className="button button-secondary" onClick={downloadDraft}><Download size={15} aria-hidden="true" />下载文件</button>{isAccepted ? <button className="button button-secondary" onClick={restoreDraft}><RotateCcw size={15} aria-hidden="true" />恢复待审核</button> : <button className="button button-primary" onClick={acceptDraft}><Check size={16} aria-hidden="true" />接受草稿</button>}</div></div>
          <p className="mv-download-note">下载的是当前选中文件的完整内容。请将它保存到上方路径；演示草稿不代表已经通过真实项目的运行验证。</p>
        </section>
      </div>
    </div>
  );
}
