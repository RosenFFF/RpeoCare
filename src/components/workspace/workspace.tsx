"use client";

import Link from "next/link";
import { BrandMark } from "../../shared/components/brand-mark";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowRight, Bell, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, Command, GitBranch, GitFork, Menu, PanelLeftClose, PanelLeftOpen, Search, Sparkles, X } from "lucide-react";
import { ThemePicker } from "../../shared/components/theme-picker";
import { useAppearance } from "@/shared/lib/use-appearance";
import { navigation, type ViewId } from "@/shared/lib/navigation";
import { GitItems } from "@/features/workbench/git-items";
import { DraftWorkspace } from "@/features/workbench/draft-workspace";
import { useWorkbench } from "@/features/workbench/client";
import { OverviewView } from "../../features/overview/overview-view";
import { AgentWorkspace } from "../../features/agent/agent-workspace";
import { AuditView } from "../../features/audit/audit-view";
import { SettingsView } from "../../features/settings/settings-view";

import { RepositoryChooser } from "@/features/workbench/repository-chooser";

type Modal = "search" | "project" | "help" | "notifications" | null;

const navigationGroups: { label: string; items: ViewId[] }[] = [
  { label: "项目", items: ["overview", "audit", "agent"] },
  { label: "协作审阅", items: ["issues", "pull-requests"] },
  { label: "交付", items: ["improvements"] },
];

export function Workspace({ view }: { view: ViewId }) {
  const { data: workbench } = useWorkbench();
  const { appearance, updateAppearance } = useAppearance();
  const workspaceName = workbench?.project?.fullName || "尚未连接项目";
  const [isMobile, setIsMobile] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [notificationRead, setNotificationRead] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const resize = () => { setIsMobile(mq.matches); if (!mq.matches) setMobileOpen(false); };
    resize(); mq.addEventListener("change", resize);
    return () => { mq.removeEventListener("change", resize); };
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
      const elements = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea, [tabindex="0"]');
      if (!elements?.length) return;
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", trap);
    return () => { clearTimeout(timer); document.removeEventListener("keydown", trap); previous?.focus(); };
  }, [modal]);
  const searchItems = navigation.filter(item => `${item.label} ${item.english}`.toLowerCase().includes(query.toLowerCase()));

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    {mobileOpen && <button className="sidebar-scrim" aria-label="关闭导航" onClick={() => setMobileOpen(false)} />}
    <aside id="workspace-sidebar" ref={sidebarRef} inert={isMobile && !mobileOpen} className={`sidebar ${mobileOpen ? "is-open" : ""}`} aria-label="主导航">
      <Link href="/" className="brand" aria-label="返回 RepoCare 首页"><BrandMark /><span>RepoCare<span className="brand-dot">.</span></span></Link>
      <div className="workspace-label">MAINTAINER WORKSPACE</div>
      <button type="button" className="project-switcher" aria-label={`切换项目：${workspaceName}`} title={`切换项目：${workspaceName}`} onClick={() => {setMobileOpen(false); setModal("project");}}><span className="project-avatar">{workbench?.project?.fullName.split("/").pop()?.slice(0, 1).toUpperCase() || "R"}</span><span className="project-switcher-name">{workspaceName}<small>个人开源项目</small></span><ChevronDown size={15} /></button>
      <div className="nav-section-label">维护流程 <span>WORKFLOW</span></div>
      <nav className="nav-groups" aria-label="维护流程">{navigationGroups.map(group => <div className="nav-group" key={group.label}><span className="nav-group-label">{group.label}</span><div className="nav-links">{group.items.map(id => { const item = navigation.find(entry => entry.id === id)!; return <Link onClick={() => setMobileOpen(false)} href={item.href} key={item.id} aria-label={item.label} title={item.label} aria-current={view === item.id ? "page" : undefined} className={`nav-link ${view === item.id ? "active" : ""}`}><item.icon size={18} strokeWidth={1.7} /><span>{item.label}</span></Link>; })}</div></div>)}</nav>
      <div className="sidebar-bottom"><Link href="/settings" aria-label="工作区设置" title="工作区设置" onClick={() => setMobileOpen(false)} className={`nav-link ${view === "settings" ? "active" : ""}`} aria-current={view === "settings" ? "page" : undefined}><SettingsIcon /><span>工作区设置</span></Link><button type="button" className="nav-link" aria-label="使用指南" title="使用指南" onClick={() => {setMobileOpen(false); setModal("help");}}><CircleHelp size={18} strokeWidth={1.7} /><span>使用指南</span><ArrowDownLeft size={14} /></button><div className="profile" title="维护工作区"><span className="profile-avatar">M</span><div>{workbench?.github?.login || "Maintainer"}<small>{workbench?.github ? "GitHub 账户" : "本地会话"}</small></div><span className="profile-status" title="会话状态" /></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button type="button" className="icon-button sidebar-toggle" aria-label={appearance.sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} title={appearance.sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} aria-expanded={!appearance.sidebarCollapsed} aria-controls="workspace-sidebar" onClick={() => updateAppearance({ sidebarCollapsed: !appearance.sidebarCollapsed })}>{appearance.sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button><button type="button" className="icon-button mobile-menu" aria-label="打开导航" aria-controls="workspace-sidebar" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu size={19} /></button><span className="breadcrumb-project"><GitFork size={16} /><span>{workspaceName}</span></span><ChevronRight size={13} /><span>{current.label}</span></div><div className="topbar-actions"><span className="demo-badge"><span />{workbench?.project ? "项目已连接" : "等待连接项目"}</span><button type="button" className="search-button" aria-label="快速跳转" onClick={() => { setQuery(""); setModal("search"); }}><Search size={16} /><span>快速跳转</span><kbd>Ctrl K</kbd></button><ThemePicker theme={appearance.theme} onChange={theme => updateAppearance({ theme })} /><div className="topbar-divider"/><button type="button" className="icon-button notification-button" aria-label="查看通知" onClick={() => { setModal("notifications"); setNotificationRead(true); }}><Bell size={18}/>{!notificationRead && <span />}</button></div></header>
      <main id="main-content" className={`main-content view-${view}`} tabIndex={-1}>
        {view === "overview" && <OverviewView onNotify={notify} />}
        {view === "agent" && <AgentWorkspace />}
        {view === "audit" && <AuditView onNotify={notify} />}
        {view === "issues" && <GitItems kind="issues" />}
        {view === "pull-requests" && <GitItems kind="pulls" />}
        {view === "improvements" && <DraftWorkspace />}
        {view === "settings" && <SettingsView onNotify={notify} />}
        <footer className="workspace-footer"><span>RepoCare Maintainer Workspace</span><span>本地保存 · 人工确认</span></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><Check size={17}/><span>{toast}</span><button type="button" aria-label="关闭提示" onClick={() => setToast("")}><X size={15}/></button></div>}
    {modal && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setModal(null); }}><div className={`modal ${modal === "search" ? "search-modal" : modal === "project" ? "project-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={dialogRef}>
      <div className="modal-header"><div><span className="eyebrow">REPOCARE WORKSPACE</span><h2 id="modal-title">{modal === "search" ? "想去哪里？" : modal === "project" ? "连接你的开源项目" : modal === "notifications" ? "工作区动态" : "让维护工作，有条不紊。"}</h2></div><button type="button" className="icon-button" aria-label="关闭弹窗" onClick={() => setModal(null)}><X size={20}/></button></div>
      {modal === "search" && <><div className="command-input"><Search size={19}/><input aria-label="搜索页面" autoFocus placeholder="搜索页面，如 Issue、体检…" value={query} onChange={e => setQuery(e.target.value)} /></div><div className="command-results">{searchItems.length ? searchItems.map(item => <button type="button" key={item.id} onClick={() => { setModal(null); router.push(item.href); }}><item.icon size={18}/><span>{item.label}<small>{item.english}</small></span><ArrowRight size={16}/></button>) : <div className="empty-state">没有找到匹配页面，试试「体检」或「设置」。</div>}</div><div className="command-footer"><Command size={13}/> Ctrl / ⌘ + K 打开 <span>Esc 关闭</span></div></>}
      {modal === "project" && (workbench ? <RepositoryChooser github={workbench.github} currentProject={workbench.project?.fullName} onConnected={() => { setModal(null); window.location.assign('/workspace'); }}/> : <p role="status">正在读取账户信息…</p>)}
      {modal === "help" && <div className="help-content"><p>这里是维护者的工作台。先看清项目现状，再核对证据、审阅建议，最后由你决定交付哪些改进。</p>{[{n:"01",title:"看清项目现状",text:"先进入项目概览，再从固定提交开始体检。",href:"/overview"},{n:"02",title:"核对协作证据",text:"在 Issue 与 PR 中核对原文、Diff 和检查状态。",href:"/issues"},{n:"03",title:"审阅并交付",text:"集中编辑文档、回复和评论草稿，确认后再交付。",href:"/improvements"}].map(item=><Link key={item.n} href={item.href} onClick={()=>setModal(null)}><span>{item.n}</span><div><strong>{item.title}</strong><p>{item.text}</p></div><ArrowRight size={17}/></Link>)}<div className="help-note"><BookOpen size={17}/><p>连接项目后可体检、查看报告、分析 Issue 和 PR，并审阅修改草稿。发布需明确确认；不会执行仓库代码。</p></div></div>}
      {modal === "notifications" && <div className="notification-content"><div className="notification-row"><span className="notice-icon"><Sparkles size={18}/></span><div><strong>工作区已准备好</strong><p>连接项目后，查看真实 Issue、PR 和体检历史。</p><small>工作区提示</small></div></div><div className="notification-row"><span className="notice-icon"><GitBranch size={18}/></span><div><strong>每一次建议都可以回看</strong><p>在详情中查看原文、检查依据和修改草稿，确认后再继续。</p><small>使用提示</small></div></div></div>}
    </div></div>}
  </div>;
}

function SettingsIcon() { const Icon = navigation[5].icon; return <Icon size={18} strokeWidth={1.7}/>; }

