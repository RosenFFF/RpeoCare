'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Check, CheckCircle2, ChevronRight, CircleDot, Clock3, FileText, Globe2, MessageSquare, Search, ShieldCheck } from 'lucide-react';
import '../../shared/styles/review-views.css';

type IssueStatus = 'all' | 'pending' | 'reviewed';
type Issue = {
  id: number;
  title: string;
  date: string;
  author: string;
  language: string;
  type: string;
  summary: string;
  raw: string;
  actual: string;
  expected: string;
  environment: string;
  missing: string[];
  labels: string[];
  sources: { quote: string; note: string }[];
  draft: string;
  related?: { id: number; title: string; note: string };
};

const ISSUES: Issue[] = [
  {
    id: 42, title: 'Empty CSV raises IndexError', date: '2 小时前', author: 'river-dev', language: '英语 · 中文', type: 'Bug 报告',
    summary: '上传空 CSV 文件时发生 IndexError，仍需确认文件内容与运行环境。',
    raw: 'When I upload an empty CSV, csv-kit crashes with IndexError.\nI tried again and got the same result. 请问怎么解决？',
    actual: '上传空 CSV 文件后，程序抛出 IndexError。',
    expected: '未知 · 提交者未说明期望行为。',
    environment: '未知 · 未提供系统、Python 版本及 csv-kit 版本。',
    missing: ['完整错误堆栈', '可复现的最小 CSV 样例', 'Python 和 csv-kit 版本', '期望如何处理空文件'],
    labels: ['bug', 'needs-reproduction'],
    sources: [
      { quote: '“empty CSV…crashes with IndexError”', note: '来自 Issue 正文 · 支持实际行为与 Bug 类型建议' },
      { quote: '“请附上版本、错误堆栈和最小复现样例。”', note: '来自 .openbridge/rules.yml · 缺失字段依据' },
    ],
    draft: '感谢反馈！为了确认并复现这个问题，请补充：\n\n1. Python 和 csv-kit 的版本；\n2. 完整错误堆栈；\n3. 一个可复现问题的最小 CSV 文件（请移除敏感数据）；\n4. 你希望空文件返回什么结果。\n\n这些信息可以帮助我们判断是完全空白的文件，还是仅包含表头的 CSV。谢谢！',
    related: { id: 28, title: 'Header-only file produces an empty result', note: '仅内容相关：只有表头与完全空白文件可能是不同场景。请人工确认，不自动判为重复。' },
  },
  {
    id: 39, title: 'Add delimiter detection', date: '昨天', author: 'mika-data', language: '英语', type: '功能建议',
    summary: '建议自动识别分号分隔的 CSV，减少手动传入分隔符。',
    raw: 'Could csv-kit detect the delimiter automatically? My exports use semicolons, so I currently pass delimiter=";" every time. It would be nice to detect this from the first few rows.',
    actual: '提交者每次需要手动传入 delimiter=";"。',
    expected: '从文件前几行自动识别分隔符。',
    environment: '未知 · 未提供项目版本；功能建议暂不要求运行环境。',
    missing: ['有代表性的分号分隔样例', '识别失败时希望采用的回退行为'],
    labels: ['enhancement', 'needs-discussion'],
    sources: [
      { quote: '“I currently pass delimiter=\";\" every time”', note: '来自 Issue 正文 · 当前行为' },
      { quote: '“detect this from the first few rows”', note: '来自 Issue 正文 · 期望行为' },
    ],
    draft: '感谢建议！自动识别分隔符确实可以简化导入流程。可以提供一份有代表性的分号分隔 CSV 样例吗？\n\n另外，如果前几行不足以确定分隔符，你更希望回退为逗号，还是提示用户手动选择？我们会结合现有接口讨论兼容的实现方式。',
  },
  {
    id: 37, title: '安装后无法导入模块', date: '3 天前', author: 'lin-code', language: '中文', type: '使用咨询',
    summary: '安装成功后导入失败，需要先确认安装命令、导入方式和解释器环境。',
    raw: '我 pip 安装成功了，但是在 notebook 里 import csvkit 提示 ModuleNotFoundError。终端用的是 Python 3.11，不知道 notebook 是什么版本。',
    actual: 'Notebook 中执行 import csvkit 时出现 ModuleNotFoundError。',
    expected: '未知 · 未明确描述；“能够导入”仅为待确认推测。',
    environment: '终端：Python 3.11；Notebook 内核版本：未知。',
    missing: ['实际使用的安装命令', 'Notebook 的解释器路径及版本', '完整报错内容'],
    labels: ['question', 'installation'],
    sources: [
      { quote: '“在 notebook 里 import csvkit 提示 ModuleNotFoundError”', note: '来自 Issue 正文 · 报错与导入方式' },
      { quote: '“终端用的是 Python 3.11，不知道 notebook 是什么版本”', note: '来自 Issue 正文 · 环境差异尚待核实' },
    ],
    draft: '你好！目前还不能确定是模块名称还是 Notebook 环境导致的问题。请补充：\n\n1. 实际使用的 pip 安装命令；\n2. Notebook 中运行 `import sys; print(sys.executable); print(sys.version)` 的输出；\n3. 完整的报错内容。\n\n我们会结合项目的安装说明确认下一步，暂时无需重复安装。',
  },
];

const FILTERS: { value: IssueStatus; label: string }[] = [{ value: 'all', label: '全部' }, { value: 'pending', label: '待确认' }, { value: 'reviewed', label: '已确认' }];

export function IssuesView({ onNotify }: { onNotify: (message: string) => void }) {
  const [filter, setFilter] = useState<IssueStatus>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(42);
  const [drafts, setDrafts] = useState<Record<number, string>>(() => Object.fromEntries(ISSUES.map((issue) => [issue.id, issue.draft])));
  const [confirmed, setConfirmed] = useState<Record<number, string>>({});
  const [originalOpen, setOriginalOpen] = useState(true);
  const [storageReady, setStorageReady] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  useEffect(() => {
    const linkedId = Number(new URLSearchParams(window.location.search).get('issue'));
    if (ISSUES.some((issue) => issue.id === linkedId)) setSelectedId(linkedId);
    try {
      const saved = JSON.parse(sessionStorage.getItem('openbridge.issues.v1') ?? 'null');
      if (saved && typeof saved === 'object') {
        if (saved.drafts && typeof saved.drafts === 'object') setDrafts((current) => ({ ...current, ...Object.fromEntries(ISSUES.filter((issue) => typeof saved.drafts[issue.id] === 'string').map((issue) => [issue.id, saved.drafts[issue.id]])) }));
        if (saved.confirmed && typeof saved.confirmed === 'object') setConfirmed(Object.fromEntries(ISSUES.filter((issue) => typeof saved.confirmed[issue.id] === 'string').map((issue) => [issue.id, saved.confirmed[issue.id]])));
      }
    } catch { setStorageAvailable(false); }
    setStorageReady(true);
  }, []);
  useEffect(() => {
    if (!storageReady) return;
    try { sessionStorage.setItem('openbridge.issues.v1', JSON.stringify({ drafts, confirmed })); window.dispatchEvent(new Event('openbridge-demo-change')); }
    catch { setStorageAvailable(false); }
  }, [drafts, confirmed, storageReady]);
  const visibleIssues = useMemo(() => ISSUES.filter((issue) => {
    const matchesStatus = filter === 'all' || (filter === 'reviewed' ? Boolean(confirmed[issue.id]) : !confirmed[issue.id]);
    return matchesStatus && `${issue.id} ${issue.title} ${issue.summary}`.toLowerCase().includes(query.toLowerCase());
  }), [filter, query, confirmed]);
  const selected = visibleIssues.find((issue) => issue.id === selectedId) ?? visibleIssues[0] ?? null;
  const reviewCount = Object.keys(confirmed).length;

  const selectIssue = (id: number) => {
    setSelectedId(id);
    setOriginalOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.set('issue', String(id));
    url.searchParams.delete('pr');
    window.history.replaceState(window.history.state, '', url);
  };

  const confirmDraft = () => {
    if (!selected) return;
    if (!drafts[selected.id].trim()) { onNotify('请先填写回复草稿，再确认本次处理。'); return; }
    const timestamp = new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    setConfirmed((current) => ({ ...current, [selected.id]: timestamp }));
    onNotify(`Issue #${selected.id} 已记录本地确认，未向 GitHub 发送回复。`);
  };

  return (
    <div className="rv-view">
      <div className="page-heading rv-heading">
        <div><span className="eyebrow">协作维护 / ISSUES</span><h1>让每一条反馈更清晰</h1><p>保留原始信息，整理处理依据，把最后的判断交还给你。</p></div>
        <span className="rv-demo-badge"><span /> csv-kit · 演示仓库</span>
      </div>

      <div className="rv-workspace">
        <aside className="rv-sidebar" aria-label="Issue 列表">
          <div className="rv-sidebar-heading"><h2>Issues <span>3</span></h2><span className="rv-small-text">{3 - reviewCount} 条待确认</span></div>
          <label className="rv-search"><Search size={16} aria-hidden="true" /><span className="rv-sr-only">搜索 Issue</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或编号…" /></label>
          <div className="rv-filter-group" aria-label="Issue 状态筛选">{FILTERS.map((item) => <button type="button" className={filter === item.value ? 'rv-filter is-active' : 'rv-filter'} aria-pressed={filter === item.value} key={item.value} onClick={() => setFilter(item.value)}>{item.label}{item.value === 'reviewed' && reviewCount > 0 ? ` ${reviewCount}` : ''}</button>)}</div>
          <div className="rv-item-list">
            {visibleIssues.map((issue) => <button type="button" key={issue.id} className={`rv-list-item ${selected?.id === issue.id ? 'is-selected' : ''}`} onClick={() => selectIssue(issue.id)} aria-pressed={selected?.id === issue.id}>
              <div className="rv-list-item-top"><span className="rv-item-number"><CircleDot size={15} /> #{issue.id}</span><span className={confirmed[issue.id] ? 'rv-state rv-state-done' : 'rv-state'}>{confirmed[issue.id] ? '已确认' : '待确认'}</span></div>
              <h3>{issue.title}</h3><p>{issue.summary}</p><div className="rv-list-item-meta"><span>{issue.type}</span><span>{issue.date}</span></div>
            </button>)}
            {visibleIssues.length === 0 && <div className="rv-empty"><Search size={24} /><strong>没有找到匹配的 Issue</strong><p>换个关键词，或查看全部状态。</p><button type="button" onClick={() => { setQuery(''); setFilter('all'); }}>清除筛选</button></div>}
          </div>
          <div className="rv-sidebar-footer"><ShieldCheck size={16} /><span>当前为只读演示<br />{storageAvailable ? '草稿与确认保存在当前浏览器会话' : '会话存储不可用，仅保留本页状态'}</span></div>
        </aside>

        {selected ? <section className="rv-detail" aria-label={`Issue ${selected.id} 详情`}>
          <header className="rv-detail-header">
            <div className="rv-detail-kicker"><span className="rv-repo-path">csv-kit / Issues</span><span className="rv-divider-dot">·</span><span>#{selected.id}</span></div>
            <h2>{selected.title}</h2>
            <div className="rv-detail-meta"><span><CircleDot size={14} /> Open</span><span>{selected.author} · {selected.date}</span><span><Globe2 size={14} />{selected.language}</span></div>
          </header>

          <div className="rv-detail-body">
            <section className="rv-section">
              <div className="rv-section-title"><h3><FileText size={17} /> 原始反馈</h3><button type="button" className="rv-text-button" aria-expanded={originalOpen} onClick={() => setOriginalOpen(!originalOpen)}>{originalOpen ? '收起原文' : '展开原文'}<ChevronRight size={14} className={originalOpen ? 'rv-rotate' : ''} /></button></div>
              {originalOpen && <blockquote className="rv-original" id={`issue-original-${selected.id}`}>{selected.raw}</blockquote>}
            </section>

            <section className="rv-section">
              <div className="rv-section-title"><h3><span className="rv-step-number">01</span> 结构化理解</h3><span className="rv-section-hint">建议 · 等待你的判断</span></div>
              <p className="rv-summary">{selected.summary}</p>
              <dl className="rv-definition-list">
                <div><dt>实际行为</dt><dd>{selected.actual}</dd></div>
                <div><dt>预期行为</dt><dd className={selected.expected.startsWith('未知') ? 'rv-unknown' : ''}>{selected.expected}</dd></div>
                <div><dt>运行环境</dt><dd className={selected.environment.startsWith('未知') ? 'rv-unknown' : ''}>{selected.environment}</dd></div>
                <div><dt>标签建议</dt><dd className="rv-labels">{selected.labels.map((label) => <span className="rv-label" key={label}>{label}</span>)}</dd></div>
              </dl>
              <div className="rv-evidence"><div className="rv-evidence-title"><ShieldCheck size={14} /> 来源依据</div>{selected.sources.map((source) => <div className="rv-evidence-row" key={source.quote}><span className="rv-evidence-marker" /><div><p>{source.quote}</p><span>{source.note}</span></div></div>)}</div>
            </section>

            <section className="rv-section">
              <div className="rv-section-title"><h3><span className="rv-step-number">02</span> 需要补充的信息</h3><span className="rv-count">{selected.missing.length} 项</span></div>
              <ul className="rv-missing-list">{selected.missing.map((field, index) => <li key={field}><span>{String(index + 1).padStart(2, '0')}</span>{field}</li>)}</ul>
              {selected.related && <div className="rv-related"><div><span className="rv-small-text">相关线索 · 演示历史 Issue</span><strong>#{selected.related.id} {selected.related.title}</strong><p>{selected.related.note}</p></div><ArrowUpRight size={17} aria-hidden="true" /></div>}
            </section>

            <section className="rv-section rv-draft-section">
              <div className="rv-section-title"><h3><span className="rv-step-number">03</span> 回复草稿</h3><span className="rv-section-hint"><MessageSquare size={13} /> 可直接编辑</span></div>
              <label className="rv-sr-only" htmlFor={`reply-draft-${selected.id}`}>编辑 Issue #{selected.id} 的回复草稿</label>
              <textarea id={`reply-draft-${selected.id}`} className="rv-draft-input" value={drafts[selected.id]} onChange={(event) => { setDrafts((current) => ({ ...current, [selected.id]: event.target.value })); setConfirmed((current) => { const next = { ...current }; delete next[selected.id]; return next; }); }} rows={8} />
              <div className="rv-draft-bottom"><span>由你确认后，才成为最终处理意见。</span><button type="button" className="rv-text-button" onClick={() => { setDrafts((current) => ({ ...current, [selected.id]: selected.draft })); setConfirmed((current) => { const next = { ...current }; delete next[selected.id]; return next; }); onNotify('已恢复示例建议草稿。'); }}>恢复建议草稿</button></div>
            </section>
          </div>

          <footer className="rv-action-footer">
            <div className={confirmed[selected.id] ? 'rv-confirmation is-confirmed' : 'rv-confirmation'}>{confirmed[selected.id] ? <CheckCircle2 size={18} /> : <Clock3 size={18} />}<div><strong>{confirmed[selected.id] ? '本地确认已记录' : '等待维护者确认'}</strong><span>{confirmed[selected.id] ? `${confirmed[selected.id]} · 未对外发送` : '演示操作，不修改 GitHub 内容'} · {storageAvailable ? '会话保存' : '仅本页保存'}</span></div></div>
            <button type="button" className="button button-primary rv-confirm-button" onClick={confirmDraft} disabled={Boolean(confirmed[selected.id])}><Check size={16} />{confirmed[selected.id] ? '已确认' : '确认本次处理'}</button>
          </footer>
        </section> : <section className="rv-detail rv-detail-empty" aria-label="Issue 空结果"><div className="rv-empty"><CircleDot size={30} /><strong>当前没有可查看的 Issue</strong><p>调整搜索内容或状态筛选后，在这里查看处理详情。</p><button type="button" onClick={() => { setQuery(''); setFilter('all'); }}>查看全部 Issue</button></div></section>}
      </div>
    </div>
  );
}
