'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, FileCheck2, Globe2, HeartPulse, Info, LockKeyhole, MessageSquareText, Monitor, Puzzle, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import './settings-view.css';

type PluginId = 'issue-triage' | 'project-audit' | 'docs-generator' | 'pr-check';

type WorkspaceSettings = {
  projectName: string;
  language: 'zh-CN' | 'en';
  keepOriginal: boolean;
  plugins: Record<PluginId, boolean>;
};

const STORAGE_KEY = 'openbridge.workspace.settings.v1';
const DEFAULT_SETTINGS: WorkspaceSettings = {
  projectName: 'csv-kit',
  language: 'zh-CN',
  keepOriginal: true,
  plugins: {
    'issue-triage': true,
    'project-audit': true,
    'docs-generator': true,
    'pr-check': true,
  },
};

const PLUGINS = [
  { id: 'issue-triage' as const, name: 'Issue 分诊', description: '整理多语言反馈、识别缺失信息，生成回复草稿。', icon: MessageSquareText },
  { id: 'project-audit' as const, name: '项目体检', description: '检查项目文档与协作配置，梳理维护待办。', icon: HeartPulse },
  { id: 'docs-generator' as const, name: '规范生成', description: '准备贡献指南、Issue 模板与可审核的文档建议。', icon: FileCheck2 },
  { id: 'pr-check' as const, name: 'PR 检查', description: '核对变更说明、测试信息与项目贡献规范。', icon: ShieldCheck },
];

function readSettings(value: unknown): WorkspaceSettings {
  if (!value || typeof value !== 'object') return DEFAULT_SETTINGS;
  const candidate = value as Partial<WorkspaceSettings>;
  return {
    projectName: typeof candidate.projectName === 'string' && candidate.projectName.trim()
      ? candidate.projectName.trim().slice(0, 64)
      : DEFAULT_SETTINGS.projectName,
    language: candidate.language === 'en' ? 'en' : 'zh-CN',
    keepOriginal: typeof candidate.keepOriginal === 'boolean' ? candidate.keepOriginal : true,
    plugins: Object.fromEntries(PLUGINS.map(({ id }) => [
      id,
      typeof candidate.plugins?.[id] === 'boolean' ? candidate.plugins[id] : true,
    ])) as Record<PluginId, boolean>,
  };
}

function Toggle({ checked, onChange, label, disabled = false, describedBy }: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <label className={`sv-switch${disabled ? ' sv-switch-locked' : ''}`}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange?.(event.target.checked)}
        aria-label={label}
        aria-describedby={describedBy}
        disabled={disabled}
      />
      <span className="sv-switch-track" aria-hidden="true"><span /></span>
    </label>
  );
}

export function SettingsView({ onNotify }: { onNotify: (message: string) => void }) {
  const [settings, setSettings] = useState<WorkspaceSettings>(DEFAULT_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<WorkspaceSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState('');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as { settings?: unknown; savedAt?: unknown };
        const next = readSettings(parsed.settings);
        setSettings(next);
        setSavedSettings(next);
        if (typeof parsed.savedAt === 'string' && !Number.isNaN(Date.parse(parsed.savedAt))) setSavedAt(parsed.savedAt);
      }
    } catch {
      setError('暂时无法读取本地设置。你仍可调整配置，并尝试重新保存。');
    }
    setReady(true);
  }, []);

  const dirty = JSON.stringify(settings) !== JSON.stringify(savedSettings);
  const enabledCount = PLUGINS.filter(({ id }) => settings.plugins[id]).length;

  function persist(next: WorkspaceSettings, message: string) {
    if (!next.projectName.trim()) {
      setError('请填写项目显示名，方便识别当前工作区。');
      document.getElementById('sv-project-name')?.focus();
      return;
    }
    const normalized = readSettings(next);
    const timestamp = new Date().toISOString();
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, settings: normalized, savedAt: timestamp }));
      setSettings(normalized);
      setSavedSettings(normalized);
      setSavedAt(timestamp);
      window.dispatchEvent(new Event('openbridge-settings-change')); 
      setError('');
      onNotify(message);
    } catch {
      setError('保存失败，请检查浏览器是否允许本地存储。当前修改仍保留在页面中。');
      onNotify('本地设置未保存，请检查浏览器存储权限。');
    }
  }

  return (
    <div className="sv-page">
      <header className="page-heading sv-heading">
        <div>
          <p className="eyebrow">WORKSPACE / SETTINGS</p>
          <h1>工作区设置</h1>
          <p className="sv-intro">按你的维护习惯，配置一个恰到好处的工作区。</p>
        </div>
        <span className="chip sv-local-chip"><Monitor size={13} aria-hidden="true" /> 本地演示</span>
      </header>

      <form onSubmit={(event) => { event.preventDefault(); persist(settings, '工作区设置已保存在当前浏览器。'); }}>
        <section className="sv-section" aria-labelledby="sv-workspace-heading">
          <div className="sv-section-heading">
            <span className="sv-section-number" aria-hidden="true">01</span>
            <div>
              <h2 id="sv-workspace-heading">本地工作区</h2>
              <p>设置项目的显示方式与内容偏好。</p>
            </div>
          </div>
          <div className="sv-fields">
            <div className="sv-field">
              <label htmlFor="sv-project-name">项目显示名</label>
              <input
                id="sv-project-name"
                type="text"
                value={settings.projectName}
                onChange={(event) => { setSettings((current) => ({ ...current, projectName: event.target.value })); setError(''); }}
                maxLength={64}
                disabled={!ready}
                autoComplete="off"
                aria-describedby="sv-project-name-help"
              />
              <p id="sv-project-name-help">仅用于本地标识，不会重命名远程仓库。</p>
            </div>
            <div className="sv-field">
              <label htmlFor="sv-language">内容语言偏好</label>
              <div className="sv-select-wrap">
                <Globe2 size={17} aria-hidden="true" />
                <select
                  id="sv-language"
                  value={settings.language}
                  onChange={(event) => setSettings((current) => ({ ...current, language: event.target.value as WorkspaceSettings['language'] }))}
                  disabled={!ready}
                  aria-describedby="sv-language-help"
                >
                  <option value="zh-CN">简体中文</option>
                  <option value="en">English</option>
                </select>
              </div>
              <p id="sv-language-help">保存分析与草稿的语言偏好；演示界面仍使用中文。</p>
            </div>
          </div>
          <div className="sv-setting-row sv-original-row">
            <div>
              <h3>保留原始内容</h3>
              <p id="sv-original-help">翻译时保留原文，便于核对技术术语、错误信息与代码片段。</p>
            </div>
            <Toggle checked={settings.keepOriginal} onChange={(value) => setSettings((current) => ({ ...current, keepOriginal: value }))} label="保留原始内容" describedBy="sv-original-help" disabled={!ready} />
          </div>
        </section>

        <section className="sv-section sv-plugin-section" aria-labelledby="sv-plugins-heading">
          <div className="sv-section-heading">
            <span className="sv-section-number" aria-hidden="true">02</span>
            <div>
              <h2 id="sv-plugins-heading">官方插件</h2>
              <p>保留需要的辅助能力，让维护工作更专注。</p>
            </div>
            <span className="sv-plugin-count">{enabledCount} / 4 已启用</span>
          </div>
          <div className="sv-plugin-list">
            {PLUGINS.map(({ id, name, description, icon: Icon }) => (
              <div className={`sv-plugin-row${settings.plugins[id] ? '' : ' sv-plugin-off'}`} key={id}>
                <span className="sv-plugin-icon"><Icon size={20} strokeWidth={1.7} aria-hidden="true" /></span>
                <div className="sv-plugin-text">
                  <div className="sv-plugin-title"><h3>{name}</h3><span>官方</span></div>
                  <p id={`sv-${id}-help`}>{description}</p>
                </div>
                <span className="sv-plugin-status">{settings.plugins[id] ? '已启用' : '已停用'}</span>
                <Toggle checked={settings.plugins[id]} onChange={(value) => setSettings((current) => ({ ...current, plugins: { ...current.plugins, [id]: value } }))} label={`${name}插件`} describedBy={`sv-${id}-help`} disabled={!ready} />
              </div>
            ))}
          </div>
          <p className="sv-plugin-note"><Puzzle size={14} aria-hidden="true" /> 此处保存演示插件配置，不会安装软件或连接 GitHub。</p>
        </section>

        <section className="sv-section sv-review-section" aria-labelledby="sv-review-heading">
          <div className="sv-section-heading">
            <span className="sv-section-number" aria-hidden="true">03</span>
            <div>
              <h2 id="sv-review-heading">维护者审核</h2>
              <p>建议由 Agent 准备，决定始终由你作出。</p>
            </div>
          </div>
          <div className="sv-setting-row sv-review-row">
            <div className="sv-review-copy">
              <span className="sv-review-icon"><LockKeyhole size={18} aria-hidden="true" /></span>
              <div>
                <h3>发布前必须审核 <span className="sv-required">始终开启</span></h3>
                <p id="sv-review-help">对外回复、标签变更与文档修改必须经过维护者确认，此设置不可关闭。</p>
              </div>
            </div>
            <Toggle checked label="发布前必须由维护者审核，始终开启" describedBy="sv-review-help" disabled />
          </div>
        </section>

        <div className="sv-storage-note">
          <Info size={16} aria-hidden="true" />
          <p>配置仅保存在当前浏览器。清除浏览器数据会恢复默认设置；此页面不需要 API 密钥或仓库授权。</p>
        </div>
        {error && <p className="sv-error" role="alert">{error}</p>}
        <footer className="sv-actions">
          <div className="sv-save-state" aria-live="polite">
            {dirty ? <><span className="sv-unsaved-dot" /> 有未保存的更改</> : <><Check size={15} aria-hidden="true" /> {savedAt ? '设置已保存' : '当前为默认配置'}</>}
            {savedAt && !dirty && <span className="sv-save-time">{new Date(savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>}
          </div>
          <div className="sv-action-buttons">
            <button className="button button-secondary sv-reset-button" type="button" onClick={() => persist(DEFAULT_SETTINGS, '已恢复并保存默认设置。')} disabled={!ready}><RotateCcw size={15} aria-hidden="true" /> 恢复默认</button>
            <button className="button button-primary sv-save-button" type="submit" disabled={!ready}><Save size={15} aria-hidden="true" /> 保存设置 <ArrowUpRight size={15} aria-hidden="true" /></button>
          </div>
        </footer>
      </form>
    </div>
  );
}
