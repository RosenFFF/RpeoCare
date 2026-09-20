"use client";

import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowRight, Bell, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, Command, GitBranch, GitFork, Menu, PanelLeftClose, PanelLeftOpen, Plus, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { ThemePicker } from "./theme-picker";
import { useAppearance } from "@/lib/use-appearance";
import { useDemoCounts } from "@/lib/use-demo-counts";
import { navigation, type ViewId } from "@/lib/navigation";
import { OverviewView } from "./views/overview-view";
import { IssuesView } from "./views/issues-view";
import { PullRequestsView } from "./views/pull-requests-view";
import { AuditView } from "./views/audit-view";
import { ImprovementsView } from "./views/improvements-view";
import { SettingsView } from "./views/settings-view";

type Modal = "search" | "project" | "help" | "notifications" | null;

export function Workspace({ view }: { view: ViewId }) {
  const counts = useDemoCounts();
  const { appearance, updateAppearance } = useAppearance();
  const [workspaceName, setWorkspaceName] = useState("csv-kit");
  const [isMobile, setIsMobile] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [repoError, setRepoError] = useState("");
  const [toast, setToast] = useState("");
  const [notificationRead, setNotificationRead] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  useEffect(() => {
    const syncSettings = () => {
      try {
        const stored = JSON.parse(localStorage.getItem("openbridge.workspace.settings.v1") || "null");
        setWorkspaceName(stored?.settings?.projectName || "csv-kit");
        setRepoUrl(localStorage.getItem("openbridge.connection-draft") || "");
      } catch { /* Keep the built-in demo usable. */ }
    };
    syncSettings();
    const mq = window.matchMedia("(max-width: 760px)");
    const resize = () => { setIsMobile(mq.matches); if (!mq.matches) setMobileOpen(false); };
    resize(); mq.addEventListener("change", resize);
    window.addEventListener("openbridge-settings-change", syncSettings);
    return () => { mq.removeEventListener("change", resize); window.removeEventListener("openbridge-settings-change", syncSettings); };
  }, []);
  useEffect(() => {
    if (!mobileOpen || !isMobile) return;
    const previous = document.activeElement as HTMLElement;
    const timer = setTimeout(() => sidebarRef.current?.querySelector<HTMLElement>("a, button")?.focus(), 30);
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || modal) return;
      const nodes = sidebarRef.current?.querySelectorAll<HTMLElement>("a[href],button");
      if (!nodes?.length) return;
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes[nodes.length-1].focus(); }
      else if (!event.shiftKey && document.activeElement === nodes[nodes.length-1]) { event.preventDefault(); nodes[0].focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { clearTimeout(timer); document.removeEventListener("keydown",trap); previous?.focus(); };
  }, [mobileOpen, isMobile, modal]);
  const overlayOpen = Boolean(modal) || (mobileOpen && isMobile);
  useEffect(() => {
    if (!overlayOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [overlayOpen]);
  const current = navigation.find(item => item.id === view)!;
  function notify(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(""), 4200);
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  useEffect(() => {
    function keys(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setMobileOpen(false); setQuery(""); setModal(value => value === "search" ? null : "search");
      }
      if (event.key === "Escape") { setModal(null); setMobileOpen(false); }
    }
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, []);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement;
    const timer = setTimeout(() => (dialogRef.current?.querySelector<HTMLElement>("input") || dialogRef.current?.querySelector<HTMLElement>("button, a"))?.focus(), 30);
    function trap(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const elements = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea, [tabindex="0"]');
      if (!elements?.length) return;
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", trap);
    return () => { clearTimeout(timer); document.removeEventListener("keydown", trap); previous?.focus(); };
  }, [modal]);
  function saveProject(event: React.FormEvent) {
    event.preventDefault();
    try {
      const url = new URL(repoUrl);
      if (url.protocol !== "https:" || !["github.com", "gitee.com"].includes(url.hostname) || url.pathname.split("/").filter(Boolean).length !== 2 || url.search || url.hash) throw new Error();
      localStorage.setItem("openbridge.connection-draft", url.href);
      setModal(null); setRepoError(""); notify("仓库地址已保存为本地草稿。当前仍展示 csv-kit 演示数据。");
    } catch { setRepoError("请填写有效的 GitHub 或 Gitee 仓库地址，例如 https://github.com/owner/repo。"); }
  }
  const searchItems = navigation.filter(item => `${item.label} ${item.english}`.toLowerCase().includes(query.toLowerCase()));

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    {mobileOpen && <button className="sidebar-scrim" aria-label="关闭导航" onClick={() => setMobileOpen(false)} />}
    <aside id="workspace-sidebar" ref={sidebarRef} inert={isMobile && !mobileOpen} className={`sidebar ${mobileOpen ? "is-open" : ""}`} aria-label="主导航">
      <Link href="/" className="brand" aria-label="返回 RepoCare 首页"><BrandMark /><span>RepoCare<span className="brand-dot">.</span></span></Link>
      <div className="workspace-label">MAINTAINER WORKSPACE</div>
      <button type="button" className="project-switcher" aria-label={`切换项目：${workspaceName}`} title={`切换项目：${workspaceName}`} onClick={() => {setMobileOpen(false); setModal("project");}}><span className="project-avatar">c<span>k</span></span><span className="project-switcher-name">{workspaceName}<small>个人开源项目</small></span><ChevronDown size={15} /></button>
      <div className="nav-section-label">工作台 <span>WORKSPACE</span></div>
      <nav className="nav-links">{navigation.filter(item => item.id !== "settings").map(item => <Link onClick={() => setMobileOpen(false)} href={item.href} key={item.id} aria-label={item.label} title={item.label} aria-current={view === item.id ? "page" : undefined} className={`nav-link ${view === item.id ? "active" : ""}`}><item.icon size={18} strokeWidth={1.7} /><span>{item.label}</span>{"count" in item && <span className="nav-count">{item.id === "issues" ? counts.issues : counts.prs}</span>}</Link>)}</nav>
      <div className="sidebar-note"><div className="sidebar-note-icon"><ShieldCheck size={18} /></div><strong>每一步，由你决定。</strong><p>建议先成为草稿，<br />确认之后，再向前一步。</p><button type="button" onClick={() => {setMobileOpen(false); setModal("help");}}>了解工作方式 <ArrowRight size={13} /></button></div>
      <div className="sidebar-bottom"><Link href="/settings" aria-label="工作区设置" title="工作区设置" onClick={() => setMobileOpen(false)} className={`nav-link ${view === "settings" ? "active" : ""}`} aria-current={view === "settings" ? "page" : undefined}><SettingsIcon /><span>工作区设置</span></Link><button type="button" className="nav-link" aria-label="使用指南" title="使用指南" onClick={() => {setMobileOpen(false); setModal("help");}}><CircleHelp size={18} strokeWidth={1.7} /><span>使用指南</span><ArrowDownLeft size={14} /></button><div className="profile" title="Maintainer · 本地演示空间"><span className="profile-avatar">M</span><div>Maintainer<small>本地演示空间</small></div><span className="profile-status" title="演示模式" /></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button type="button" className="icon-button sidebar-toggle" aria-label={appearance.sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} title={appearance.sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} aria-expanded={!appearance.sidebarCollapsed} aria-controls="workspace-sidebar" onClick={() => updateAppearance({ sidebarCollapsed: !appearance.sidebarCollapsed })}>{appearance.sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button><button type="button" className="icon-button mobile-menu" aria-label="打开导航" aria-controls="workspace-sidebar" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu size={19} /></button><span className="breadcrumb-project"><GitFork size={16} /><span>{workspaceName}</span></span><ChevronRight size={13} /><span>{current.label}</span></div><div className="topbar-actions"><span className="demo-badge"><span />演示工作区</span><button type="button" className="search-button" aria-label="快速跳转" onClick={() => { setQuery(""); setModal("search"); }}><Search size={16} /><span>快速跳转</span><kbd>Ctrl K</kbd></button><ThemePicker theme={appearance.theme} onChange={theme => updateAppearance({ theme })} /><div className="topbar-divider"/><button type="button" className="icon-button notification-button" aria-label="查看通知" onClick={() => { setModal("notifications"); setNotificationRead(true); }}><Bell size={18}/>{!notificationRead && <span />}</button><span className="header-avatar">M</span></div></header>
      <main id="main-content" className={`main-content view-${view}`} tabIndex={-1}>
        {view === "overview" && <OverviewView onNotify={notify} />}
        {view === "audit" && <AuditView onNotify={notify} />}
        {view === "issues" && <IssuesView onNotify={notify} />}
        {view === "pull-requests" && <PullRequestsView onNotify={notify} />}
        {view === "improvements" && <ImprovementsView onNotify={notify} />}
        {view === "settings" && <SettingsView onNotify={notify} />}
        <footer className="workspace-footer"><span><span className="footer-dot"/>所有演示操作仅保留在本地</span><span>REPOCARE <span className="footer-version">/ 0.1</span></span></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><Check size={17}/><span>{toast}</span><button type="button" aria-label="关闭提示" onClick={() => setToast("")}><X size={15}/></button></div>}
    {modal && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setModal(null); }}><div className={`modal ${modal === "search" ? "search-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={dialogRef}>
      <div className="modal-header"><div><span className="eyebrow">REPOCARE WORKSPACE</span><h2 id="modal-title">{modal === "search" ? "想去哪里？" : modal === "project" ? "连接你的开源项目" : modal === "notifications" ? "工作区动态" : "让维护工作，有条不紊。"}</h2></div><button type="button" className="icon-button" aria-label="关闭弹窗" onClick={() => setModal(null)}><X size={20}/></button></div>
      {modal === "search" && <><div className="command-input"><Search size={19}/><input aria-label="搜索页面" autoFocus placeholder="搜索页面，如 Issue、体检…" value={query} onChange={e => setQuery(e.target.value)} /></div><div className="command-results">{searchItems.length ? searchItems.map(item => <button type="button" key={item.id} onClick={() => { setModal(null); router.push(item.href); }}><item.icon size={18}/><span>{item.label}<small>{item.english}</small></span><ArrowRight size={16}/></button>) : <div className="empty-state">没有找到匹配页面，试试「体检」或「设置」。</div>}</div><div className="command-footer"><Command size={13}/> Ctrl / ⌘ + K 打开 <span>Esc 关闭</span></div></>}
      {modal === "project" && <form className="connect-form" onSubmit={saveProject}><p>先体验示例项目，也可以保存自己的仓库地址，为后续接入做好准备。</p><div className="connected-project"><span className="project-avatar">ck</span><div><strong>repocare-demo / csv-kit</strong><small>当前示例项目 · 虚构数据</small></div><Check size={18}/></div><label htmlFor="repo-url">你的仓库地址</label><input id="repo-url" type="url" required value={repoUrl} onChange={e => {setRepoUrl(e.target.value); setRepoError("");}} placeholder="https://github.com/owner/repo" aria-describedby="repo-hint"/>{repoError && <p className="field-error" role="alert">{repoError}</p>}<p id="repo-hint" className="form-hint">当前是前端预览。地址仅保存到此浏览器，不会连接远程仓库或读取代码。</p><button type="submit" className="button button-primary"><Plus size={16}/>保存连接草稿</button></form>}
      {modal === "help" && <div className="help-content"><p>这里是维护者的工作台。先发现问题，再审阅建议，最后由你决定采用哪些改进。</p>{[{n:"01",title:"看清项目现状",text:"从项目体检开始，查看文档、协作规范和工程检查。",href:"/audit"},{n:"02",title:"处理一条反馈",text:"在 Issue 分诊中核对原文、缺失信息，编辑回复草稿。",href:"/issues"},{n:"03",title:"把建议变成改进",text:"审阅 PR 检查和规范 Diff，下载你确认的文件。",href:"/improvements"}].map(item=><Link key={item.n} href={item.href} onClick={()=>setModal(null)}><span>{item.n}</span><div><strong>{item.title}</strong><p>{item.text}</p></div><ArrowRight size={17}/></Link>)}<div className="help-note"><BookOpen size={17}/><p>此版本使用虚构的 csv-kit 示例。AI 分析、测试执行和 GitHub 写入将在后端接入后开放。</p></div></div>}
      {modal === "notifications" && <div className="notification-content"><div className="notification-row"><span className="notice-icon"><Sparkles size={18}/></span><div><strong>你的演示工作区已准备好</strong><p>从 3 条 Issue、2 项待审 PR 和规范改进开始体验。</p><small>示例动态</small></div></div><div className="notification-row"><span className="notice-icon"><GitBranch size={18}/></span><div><strong>每一次建议都可以回看</strong><p>在详情中查看原文、检查依据和修改草稿，确认后再继续。</p><small>使用提示</small></div></div></div>}
    </div></div>}
  </div>;
}

function SettingsIcon() { const Icon = navigation[5].icon; return <Icon size={18} strokeWidth={1.7}/>; }
