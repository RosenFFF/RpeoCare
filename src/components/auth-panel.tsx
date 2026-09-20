"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Check, Eye, EyeOff, GitFork, LoaderCircle } from "lucide-react";
import { beginGitSignIn, submitEmailAuth, type GitProvider } from "@/lib/auth-client";

export type EntryView = "welcome" | "login" | "register" | "reset";
export function AuthPanel({ mode, onChange }: { mode: Exclude<EntryView, "welcome">; onChange: (mode: EntryView) => void }) {
  const [visible, setVisible] = useState(false);
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const registration = mode === "register";
  const resetting = mode === "reset";
  async function providerSignIn(provider: GitProvider) {
    setPending(provider); setNotice("");
    try { const result = await beginGitSignIn(provider); setNotice(result.message); }
    catch { setNotice("暂时无法连接登录服务，请稍后再试。"); }
    finally { setPending(null); }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice("");
    const fields = new FormData(event.currentTarget);
    if (registration && String(fields.get("name") || "").trim().length < 2) { setError("称呼至少需要 2 个非空字符。"); form.current?.querySelector<HTMLInputElement>('[name="name"]')?.focus(); return; }
    if (registration && fields.get("password") !== fields.get("confirm")) { setError("两次输入的密码不一致。"); form.current?.querySelector<HTMLInputElement>('[name="confirm"]')?.focus(); return; }
    setPending("email");
    try { const result = await submitEmailAuth(mode); setNotice(result.message); setPassword(""); form.current?.reset(); }
    catch { setNotice("暂时无法连接账号服务，请稍后再试。"); }
    finally { setPending(null); }
  }
  return <div className={`entry-auth ${registration ? "entry-auth-register" : ""}`}>
    <div className="entry-auth-navigation">
    {!resetting && <div className="entry-auth-tabs" aria-label="账号入口"><button type="button" aria-pressed={!registration} onClick={() => onChange("login")}>登录</button><button type="button" aria-pressed={registration} onClick={() => onChange("register")}>注册</button></div>}
    <button type="button" className="entry-back" onClick={() => onChange(resetting ? "login" : "welcome")}>{resetting ? "返回登录" : "返回介绍"}</button>
    </div>
    <h1 className="entry-auth-title" tabIndex={-1}>{registration ? "从这里，开始照料。" : resetting ? "找回你的账号。" : "欢迎回来，创造者。"}</h1>
    <p className="entry-auth-subtitle">{registration ? "用邮箱创建属于你的维护空间。" : resetting ? "输入注册邮箱，申请重置密码。" : "选择 Git 账号，或使用邮箱继续。"}</p>
    {!registration && !resetting && <><div className="entry-providers">{([{ id: "github", name: "GitHub", mark: "gh" }, { id: "gitee", name: "Gitee", mark: "g" }, { id: "gitlab", name: "GitLab", mark: "gl" }] as const).map(provider => <button type="button" key={provider.id} disabled={!!pending} onClick={() => providerSignIn(provider.id)} aria-label={`使用 ${provider.name} 授权登录`}><span className={`entry-provider-mark provider-${provider.id}`}>{provider.id === "gitee" ? "g" : <GitFork size={18}/>}</span><span>{provider.name}</span>{pending === provider.id && <LoaderCircle size={13} className="entry-spin"/>}</button>)}</div><p className="entry-or">或使用邮箱登录</p></>}
    <form ref={form} onSubmit={submit} className="entry-form">
      {registration && <label htmlFor="entry-name">怎么称呼你<input id="entry-name" name="name" autoComplete="nickname" required minLength={2} maxLength={40} placeholder="你的名字或开源昵称" /></label>}
      <label htmlFor="entry-email">邮箱地址<div className="entry-input-wrap"><input id="entry-email" type="email" name="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" /></div></label>
      {!resetting && <><div className="entry-field"><div className="entry-label-row"><label htmlFor="entry-password">密码</label>{!registration && <button type="button" onClick={() => onChange("reset")}>忘记密码？</button>}</div><div className="entry-input-wrap entry-password"><input id="entry-password" name="password" type={visible ? "text" : "password"} autoComplete={registration ? "new-password" : "current-password"} required minLength={registration ? 8 : 1} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} placeholder={registration ? "至少 8 位，建议混合字母与数字" : "输入你的密码"} aria-describedby={registration ? "entry-password-hint" : undefined}/><button type="button" aria-label={visible ? "隐藏密码" : "显示密码"} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div></div>{registration && <><p id="entry-password-hint" className={`entry-password-hint ${password.length >= 8 ? "is-valid" : ""}`}><Check size={12}/>至少 8 个字符</p><label htmlFor="entry-confirm">确认密码<input id="entry-confirm" name="confirm" type={visible ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={128} placeholder="再输入一次密码" aria-describedby={error ? "entry-form-error" : undefined}/></label></>}</>}
      {error && <p id="entry-form-error" className="entry-form-error" role="alert">{error}</p>}
      {notice && <div className="entry-auth-notice" role="status">{notice}<Link href="/overview">体验演示</Link></div>}
      <button type="submit" className="entry-primary entry-submit" disabled={!!pending}>{pending === "email" ? <LoaderCircle size={17} className="entry-spin"/> : null}{registration ? "创建账号" : resetting ? "发送重置邮件" : "立即登录"}</button>
    </form>
    <p className="entry-auth-switch">{registration ? "已有账号？" : "还没有账号？"}<button type="button" onClick={() => onChange(registration ? "login" : "register")}>{registration ? "去登录" : "邮箱注册"}</button></p>
    <p className="entry-preview-note">账号服务尚未开通，可先<Link href="/overview">体验演示</Link></p>
  </div>;
}
