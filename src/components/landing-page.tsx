"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "./brand-mark";
import { BrandSculpture } from "./brand-sculpture";
import { ThemePicker } from "./theme-picker";
import { useAppearance } from "@/lib/use-appearance";
import { AuthPanel, type EntryView } from "./auth-panel";
import "./landing-page.css";

function viewFromURL(): EntryView {
  const value = new URLSearchParams(window.location.search).get("auth");
  return value === "login" || value === "register" || value === "reset" ? value : "welcome";
}

export function LandingPage({ initialView = "welcome" }: { initialView?: EntryView }) {
  const { appearance, updateAppearance } = useAppearance();
  const [view, setView] = useState<EntryView>(initialView);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sync = () => setView(viewFromURL());
    if (initialView === "welcome") sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [initialView]);
  function changeView(next: EntryView) {
    if (next === view) return;
    setView(next);
    window.history.pushState(null, "", next === "welcome" ? "/" : `/?auth=${next}`);
    requestAnimationFrame(() => {
      panel.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
      if (window.innerWidth <= 850) panel.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    });
  }
  return <div className={`entry-page ${view !== "welcome" ? "entry-auth-open" : ""}`}>
    <a className="skip-link" href="#entry-content">跳到主要内容</a>
    <header className="entry-header"><Link href="/" className="entry-brand" aria-label="RepoCare 首页" onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); changeView("welcome"); } }}><BrandMark size={33}/><span>RepoCare<span className="entry-brand-dot">.</span></span></Link><nav aria-label="首页导航"><button type="button" onClick={() => { if (view !== "welcome") changeView("welcome"); else document.getElementById("entry-model")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" }); }}>品牌介绍</button><Link href="/overview">演示工作台</Link></nav><div className="entry-header-actions"><ThemePicker theme={appearance.theme} onChange={theme => updateAppearance({ theme })}/><button type="button" className="entry-header-login" onClick={() => changeView("login")}>登录</button></div></header>
    <main id="entry-content" className="entry-main">
      <section id="entry-model" className="entry-visual" aria-label="RepoCare 品牌展示">
        <span className="entry-art-word" aria-hidden="true">Care.</span>
        <BrandSculpture />
      </section>
      <section ref={panel} className="entry-panel" aria-label={view === "welcome" ? "开始使用 RepoCare" : "账号入口"}>
        <div className="entry-panel-content" key={view}>{view === "welcome" ? <div className="entry-welcome"><p className="entry-welcome-label">献给每一位开源创造者</p><h1 tabIndex={-1}>让好的项目，<br/>一直生长。</h1><p className="entry-welcome-description">RepoCare，你的开源维护搭档。<br/>理清反馈、梳理变更、照料日常，<br/>把时间留给真正想创造的事。</p><div className="entry-welcome-actions"><button type="button" className="entry-primary" onClick={() => changeView("login")}>开始使用</button><Link className="entry-demo-link" href="/overview">体验演示</Link></div><p className="entry-account-methods">GitHub / Gitee / GitLab / 邮箱<span>账号服务筹备中，可先体验演示</span></p></div> : <AuthPanel mode={view} onChange={changeView}/>}</div>
      </section>
    </main>
    <footer className="entry-footer"><span>RepoCare<span className="entry-footer-dot"/>让开源维护，从容一点。</span><span>交互原型 · 示例仓库数据</span></footer>
  </div>;
}
