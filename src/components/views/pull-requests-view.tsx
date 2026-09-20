'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AlertCircle, Check, CheckCircle2, Circle, Clock3, FileCode2, GitPullRequest, MessageSquare, Search, ShieldCheck } from 'lucide-react';
import './review-views.css';

type ReviewFilter = 'all' | 'pending' | 'reviewed';
type PullRequest = {
  id: number; title: string; author: string; date: string; summary: string; branch: string;
  additions: number; deletions: number; files: number; linkedIssue: number;
  diff: { file: string; lines: { kind: 'context' | 'add' | 'remove' | 'hunk'; text: string }[] }[];
  checks: { status: 'pass' | 'attention' | 'unknown'; title: string; description: string }[];
  draft: string;
};

const PULL_REQUESTS: PullRequest[] = [
  {
    id: 45, title: 'Handle empty CSV input gracefully', author: 'river-dev', date: '40 分钟前', summary: '为空 CSV 增加显式错误，补充回归测试。', branch: 'fix/empty-csv', additions: 14, deletions: 1, files: 2, linkedIssue: 42,
    diff: [
      { file: 'src/csv_kit/reader.py', lines: [
        { kind: 'hunk', text: '@@ -18,5 +18,8 @@ def read_csv(source):' },
        { kind: 'context', text: '    rows = list(csv.reader(source))' },
        { kind: 'remove', text: '    header = rows[0]' },
        { kind: 'add', text: '    if not rows:' },
        { kind: 'add', text: '        raise ValueError("CSV file is empty")' },
        { kind: 'add', text: '    header = rows[0]' },
        { kind: 'context', text: '    return [dict(zip(header, row)) for row in rows[1:]]' },
      ] },
      { file: 'tests/test_reader.py', lines: [
        { kind: 'hunk', text: '@@ -32,0 +33,10 @@' },
        { kind: 'add', text: 'def test_empty_csv_raises_clear_error():' },
        { kind: 'add', text: '    source = io.StringIO("")' },
        { kind: 'add', text: '    with pytest.raises(ValueError, match="CSV file is empty"):' },
        { kind: 'add', text: '        read_csv(source)' },
      ] },
    ],
    checks: [
      { status: 'pass', title: '已关联 Issue #42', description: '示例 PR 描述中包含 Fixes #42，改动围绕空 CSV 场景。' },
      { status: 'pass', title: '包含回归测试代码', description: 'Diff 中新增空字符串输入测试；存在测试代码不代表测试已通过。' },
      { status: 'attention', title: '空输入的预期行为待确认', description: '原 Issue 未说明应该抛出异常还是返回空结果，需要维护者确认接口约定。' },
      { status: 'attention', title: '建议补充仅有表头的边界测试', description: '当前示例测试没有覆盖只有表头、没有数据行的 CSV。' },
      { status: 'unknown', title: '测试与 CI 执行状态未知', description: '此页面为静态演示，未拉取 CI，也未执行 pytest。' },
    ],
    draft: '感谢这个修复，空输入的处理已经有了明确的入口，也补充了回归测试代码。\n\n合并前希望确认两点：\n1. 原 Issue 没有约定空文件的预期行为，请确认抛出 ValueError 与现有 API 设计一致；\n2. 请增加“仅包含表头”的测试，避免影响当前有效场景。\n\n本次仅审阅示例 Diff，测试及 CI 状态仍需实际验证。',
  },
  {
    id: 43, title: 'Expose delimiter option in CLI', author: 'mika-data', date: '昨天', summary: '让命令行支持显式指定 CSV 分隔符。', branch: 'feat/cli-delimiter', additions: 18, deletions: 2, files: 2, linkedIssue: 39,
    diff: [
      { file: 'src/csv_kit/cli.py', lines: [
        { kind: 'hunk', text: '@@ -12,4 +12,7 @@ def build_parser():' },
        { kind: 'context', text: '    parser.add_argument("source")' },
        { kind: 'add', text: '    parser.add_argument(' },
        { kind: 'add', text: '        "--delimiter", default=",", help="CSV delimiter"' },
        { kind: 'add', text: '    )' },
        { kind: 'context', text: '    return parser' },
        { kind: 'hunk', text: '@@ -28,2 +31,2 @@ def main():' },
        { kind: 'remove', text: '    data = read_csv(args.source)' },
        { kind: 'add', text: '    data = read_csv(args.source, delimiter=args.delimiter)' },
      ] },
      { file: 'README.md', lines: [
        { kind: 'hunk', text: '@@ -42,0 +43,4 @@' },
        { kind: 'add', text: 'Use a custom delimiter:' },
        { kind: 'add', text: '```sh' },
        { kind: 'add', text: "csv-kit export.csv --delimiter ';'" },
        { kind: 'add', text: '```' },
      ] },
    ],
    checks: [
      { status: 'attention', title: '与 Issue #39 的需求不完全一致', description: 'Issue 提出自动识别，此 PR 增加手动参数。可以作为独立改进，不能直接认定解决原需求。' },
      { status: 'pass', title: '已补充使用示例', description: 'README 新增了 --delimiter 的命令行用法。' },
      { status: 'attention', title: '示例 Diff 未包含测试', description: '建议覆盖默认逗号、显式分号与无效分隔符。' },
      { status: 'unknown', title: '测试与 CI 执行状态未知', description: '此页面为静态演示，未拉取 CI，也未执行测试命令。' },
    ],
    draft: '谢谢补充 CLI 分隔符参数，README 示例也很清楚。\n\n这个改动提供了手动指定能力，但 Issue #39 讨论的是自动识别。建议调整关联说明，暂不使用 Fixes #39。\n\n请补充默认逗号和显式分号的命令行测试，并说明无效分隔符的行为。当前演示未执行测试，合并前还需确认 CI 结果。',
  },
  {
    id: 40, title: 'Clarify notebook installation steps', author: 'lin-code', date: '2 天前', summary: '补充 Notebook 安装与解释器排查说明。', branch: 'docs/notebook-setup', additions: 12, deletions: 0, files: 1, linkedIssue: 37,
    diff: [
      { file: 'docs/installation.md', lines: [
        { kind: 'hunk', text: '@@ -21,0 +22,12 @@' },
        { kind: 'add', text: '## 在 Notebook 中安装' },
        { kind: 'add', text: '使用当前内核的 Python 解释器安装依赖：' },
        { kind: 'add', text: '```python' },
        { kind: 'add', text: 'import sys' },
        { kind: 'add', text: 'print(sys.executable)' },
        { kind: 'add', text: '```' },
        { kind: 'add', text: '确认安装目标与当前 Notebook 内核一致。' },
        { kind: 'add', text: '如果仍无法导入，请附上安装命令、版本和完整错误信息。' },
      ] },
    ],
    checks: [
      { status: 'pass', title: '与 Issue #37 关联明确', description: '文档补充了该反馈中缺失的 Notebook 环境排查步骤。' },
      { status: 'pass', title: '修改范围集中', description: '示例 Diff 仅涉及安装文档，没有业务代码改动。' },
      { status: 'attention', title: '安装命令尚未明确', description: '当前内容解释了环境判断，但没有给出经过验证的安装命令。' },
      { status: 'unknown', title: '文档示例执行情况未知', description: '此页面为静态演示，未在真实 Notebook 中验证。' },
    ],
    draft: '感谢完善 Notebook 的排查说明，解释器信息能帮助用户提供更有效的反馈。\n\n建议再补充一条经过验证、适用于当前 Notebook 内核的安装命令，并核对项目实际导入名称。\n\n这里仅完成文档 Diff 的示例审阅，命令仍需在干净环境中验证。',
  },
];

const PR_FILTERS: { value: ReviewFilter; label: string }[] = [{ value: 'all', label: '全部' }, { value: 'pending', label: '待审阅' }, { value: 'reviewed', label: '已审阅' }];

export function PullRequestsView({ onNotify }: { onNotify: (message: string) => void }) {
  const [selectedId, setSelectedId] = useState(45);
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'diff' | 'checks'>('diff');
  const [drafts, setDrafts] = useState<Record<number, string>>(() => Object.fromEntries(PULL_REQUESTS.map((pr) => [pr.id, pr.draft])));
  const [confirmed, setConfirmed] = useState<Record<number, string>>({ 40: '演示预置记录' });
  const [checked, setChecked] = useState<Record<number, boolean>>({ 40: true });
  const [storageReady, setStorageReady] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const diffTabRef = useRef<HTMLButtonElement>(null);
  const checksTabRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const linkedId = Number(new URLSearchParams(window.location.search).get('pr'));
    if (PULL_REQUESTS.some((pr) => pr.id === linkedId)) setSelectedId(linkedId);
    try {
      const saved = JSON.parse(sessionStorage.getItem('openbridge.prs.v1') ?? 'null');
      if (saved && typeof saved === 'object') {
        if (saved.drafts && typeof saved.drafts === 'object') setDrafts((current) => ({ ...current, ...Object.fromEntries(PULL_REQUESTS.filter((pr) => typeof saved.drafts[pr.id] === 'string').map((pr) => [pr.id, saved.drafts[pr.id]])) }));
        if (saved.confirmed && typeof saved.confirmed === 'object') {
          const restored = Object.fromEntries(PULL_REQUESTS.filter((pr) => typeof saved.confirmed[pr.id] === 'string').map((pr) => [pr.id, saved.confirmed[pr.id]]));
          setConfirmed(restored);
          setChecked(Object.fromEntries(Object.keys(restored).map((id) => [Number(id), true])));
        }
        if (saved.checked && typeof saved.checked === 'object') setChecked(Object.fromEntries(PULL_REQUESTS.filter((pr) => typeof saved.checked[pr.id] === 'boolean').map((pr) => [pr.id, saved.checked[pr.id]])));
      }
    } catch { setStorageAvailable(false); }
    setStorageReady(true);
  }, []);
  useEffect(() => {
    if (!storageReady) return;
    try { sessionStorage.setItem('openbridge.prs.v1', JSON.stringify({ drafts, confirmed, checked })); window.dispatchEvent(new Event('openbridge-demo-change')); }
    catch { setStorageAvailable(false); }
  }, [drafts, confirmed, checked, storageReady]);
  const visiblePRs = useMemo(() => PULL_REQUESTS.filter((pr) => (filter === 'all' || (filter === 'reviewed' ? Boolean(confirmed[pr.id]) : !confirmed[pr.id])) && `${pr.id} ${pr.title} ${pr.summary}`.toLowerCase().includes(query.toLowerCase())), [filter, query, confirmed]);
  const selected = visiblePRs.find((pr) => pr.id === selectedId) ?? visiblePRs[0] ?? null;
  const attentionCount = selected?.checks.filter((check) => check.status === 'attention').length ?? 0;

  const selectPR = (id: number) => {
    setSelectedId(id);
    setTab('diff');
    const url = new URL(window.location.href);
    url.searchParams.set('pr', String(id));
    url.searchParams.delete('issue');
    window.history.replaceState(window.history.state, '', url);
  };

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextTab = event.key === 'Home' ? 'diff' : event.key === 'End' ? 'checks' : tab === 'diff' ? 'checks' : 'diff';
    setTab(nextTab);
    (nextTab === 'diff' ? diffTabRef : checksTabRef).current?.focus();
  };

  function confirmReview() {
    if (!selected) return;
    if (!checked[selected.id]) { onNotify('请先确认已审阅改动与待核实事项。'); return; }
    if (!drafts[selected.id].trim()) { onNotify('请填写审核意见后再确认。'); return; }
    const timestamp = new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    setConfirmed((current) => ({ ...current, [selected.id]: timestamp }));
    onNotify(`PR #${selected.id} 的审阅已在本地记录，未发布 Review 或合并代码。`);
  }

  return (
    <div className="rv-view">
      <div className="page-heading rv-heading"><div><span className="eyebrow">协作维护 / PULL REQUESTS</span><h1>让每一次审阅有据可依</h1><p>对照需求检查改动，在合并之前看清需要确认的事。</p></div><span className="rv-demo-badge"><span /> csv-kit · 演示仓库</span></div>
      <div className="rv-workspace">
        <aside className="rv-sidebar" aria-label="Pull Request 列表">
          <div className="rv-sidebar-heading"><h2>Pull requests <span>3</span></h2></div>
          <label className="rv-search"><Search size={16} aria-hidden="true" /><span className="rv-sr-only">搜索 Pull Request</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或编号…" /></label>
          <div className="rv-filter-group" aria-label="PR 状态筛选">{PR_FILTERS.map((item) => <button type="button" key={item.value} className={`rv-filter ${filter === item.value ? 'is-active' : ''}`} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}</div>
          <div className="rv-item-list">{visiblePRs.map((pr) => <button type="button" key={pr.id} className={`rv-list-item ${selected?.id === pr.id ? 'is-selected' : ''}`} onClick={() => selectPR(pr.id)} aria-pressed={selected?.id === pr.id}>
            <div className="rv-list-item-top"><span className="rv-item-number"><GitPullRequest size={15} /> #{pr.id}</span><span className={confirmed[pr.id] ? 'rv-state rv-state-done' : 'rv-state'}>{confirmed[pr.id] ? '已审阅' : '待审阅'}</span></div><h3>{pr.title}</h3><p>{pr.summary}</p><div className="rv-list-item-meta"><span>{pr.files} 个文件 <span className="rv-additions">+{pr.additions}</span> <span className="rv-deletions">−{pr.deletions}</span></span><span>{pr.date}</span></div>
          </button>)}{visiblePRs.length === 0 && <div className="rv-empty"><Search size={24} /><strong>没有匹配的 Pull Request</strong><p>换个关键词，或查看全部状态。</p><button type="button" onClick={() => { setQuery(''); setFilter('all'); }}>清除筛选</button></div>}</div>
          <div className="rv-sidebar-footer"><ShieldCheck size={16} /><span>演示不会合并或发布 Review<br />{storageAvailable ? '草稿与确认保存在当前浏览器会话' : '会话存储不可用，仅保留本页状态'}</span></div>
        </aside>

        {selected ? <section className="rv-detail" aria-label={`Pull Request ${selected.id} 详情`}>
          <header className="rv-detail-header"><div className="rv-detail-kicker"><span className="rv-repo-path">csv-kit / Pull requests</span><span className="rv-divider-dot">·</span><span>#{selected.id}</span></div><h2>{selected.title}</h2><div className="rv-detail-meta"><span><GitPullRequest size={14} /> Open</span><span>{selected.author} · {selected.date}</span><span>关联 Issue #{selected.linkedIssue}</span></div><div className="rv-branch-line"><code>{selected.branch}</code><span>→</span><code>main</code><span className="rv-branch-stats">{selected.files} 个文件 · <span className="rv-additions">+{selected.additions}</span> <span className="rv-deletions">−{selected.deletions}</span></span></div></header>

          <div className="rv-detail-body">
            <div className="rv-demo-notice"><AlertCircle size={16} /><p>静态演示：以下为示例 Diff 与检查建议，未执行真实测试，未获取 CI 结果。</p></div>
            <div className="rv-review-tabs" role="tablist" aria-label="PR 内容"><button type="button" ref={diffTabRef} id="rv-tab-diff" role="tab" aria-selected={tab === 'diff'} aria-controls="rv-panel-diff" tabIndex={tab === 'diff' ? 0 : -1} onKeyDown={handleTabKey} className={tab === 'diff' ? 'is-active' : ''} onClick={() => setTab('diff')}><FileCode2 size={16} /> 改动 Diff <span>{selected.files}</span></button><button type="button" ref={checksTabRef} id="rv-tab-checks" role="tab" aria-selected={tab === 'checks'} aria-controls="rv-panel-checks" tabIndex={tab === 'checks' ? 0 : -1} onKeyDown={handleTabKey} className={tab === 'checks' ? 'is-active' : ''} onClick={() => setTab('checks')}><ShieldCheck size={16} /> 质量检查 <span>{attentionCount} 项待确认</span></button></div>
            {tab === 'diff' ? <div className="rv-diff-panel" id="rv-panel-diff" role="tabpanel" aria-labelledby="rv-tab-diff">{selected.diff.map((file) => <div className="rv-diff-file" key={file.file}><div className="rv-diff-file-title"><FileCode2 size={15} /><code>{file.file}</code><span>示例片段</span></div><div className="rv-diff-scroll" tabIndex={0} role="region" aria-label="PR 差异内容，可使用方向键滚动"><pre>{file.lines.map((line, index) => <div key={`${file.file}-${index}`} className={`rv-code-line rv-code-${line.kind}`}><span className="rv-code-number">{line.kind === 'hunk' ? '…' : index + 18}</span><span className="rv-code-sign">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}</span><code>{line.text}</code></div>)}</pre></div></div>)}</div> : <div className="rv-check-panel" id="rv-panel-checks" role="tabpanel" aria-labelledby="rv-tab-checks"><div className="rv-check-summary"><span className="rv-check-summary-icon"><ShieldCheck size={22} /></span><div><h3>{attentionCount} 项需要你的判断</h3><p>依据当前示例内容整理，执行状态单独标为未知。</p></div></div>{selected.checks.map((check) => <div className={`rv-check-row rv-check-${check.status}`} key={check.title}>{check.status === 'pass' ? <CheckCircle2 size={18} /> : check.status === 'attention' ? <AlertCircle size={18} /> : <Circle size={18} />}<div><h4>{check.title}</h4><p>{check.description}</p></div><span>{check.status === 'pass' ? '已发现' : check.status === 'attention' ? '待确认' : '未知'}</span></div>)}</div>}

            <section className="rv-section rv-review-draft-section"><div className="rv-section-title"><h3><MessageSquare size={17} /> 审核意见草稿</h3><span className="rv-section-hint">你可以调整语气和结论</span></div><label className="rv-sr-only" htmlFor={`review-draft-${selected.id}`}>编辑 PR #{selected.id} 审核意见</label><textarea id={`review-draft-${selected.id}`} className="rv-draft-input" rows={8} value={drafts[selected.id]} onChange={(event) => { setDrafts((current) => ({ ...current, [selected.id]: event.target.value })); setConfirmed((current) => { const next = { ...current }; delete next[selected.id]; return next; }); setChecked((current) => ({ ...current, [selected.id]: false })); }} /><div className="rv-review-checkbox"><input id={`review-ack-${selected.id}`} type="checkbox" checked={Boolean(checked[selected.id])} disabled={Boolean(confirmed[selected.id])} onChange={(event) => setChecked((current) => ({ ...current, [selected.id]: event.target.checked }))} /><label htmlFor={`review-ack-${selected.id}`}>我已审阅示例改动与待核实事项，理解测试尚未实际执行。</label></div></section>
          </div>
          <footer className="rv-action-footer"><div className={confirmed[selected.id] ? 'rv-confirmation is-confirmed' : 'rv-confirmation'}>{confirmed[selected.id] ? <CheckCircle2 size={18} /> : <Clock3 size={18} />}<div><strong>{confirmed[selected.id] ? '本地审阅已记录' : '等待维护者审阅'}</strong><span>{confirmed[selected.id] ? `${confirmed[selected.id]} · 未发布 Review` : '确认不会提交代码或合并 PR'} · {storageAvailable ? '会话保存' : '仅本页保存'}</span></div></div><button type="button" className="button button-primary rv-confirm-button" onClick={confirmReview} disabled={Boolean(confirmed[selected.id]) || !checked[selected.id]}><Check size={16} />{confirmed[selected.id] ? '已记录审阅' : '确认审阅意见'}</button></footer>
        </section> : <section className="rv-detail rv-detail-empty" aria-label="Pull Request 空结果"><div className="rv-empty"><GitPullRequest size={30} /><strong>当前没有可查看的 Pull Request</strong><p>调整搜索内容或状态筛选后，在这里查看审阅详情。</p><button type="button" onClick={() => { setQuery(''); setFilter('all'); }}>查看全部 Pull Request</button></div></section>}
      </div>
    </div>
  );
}
