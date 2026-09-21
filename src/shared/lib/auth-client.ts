// Frontend integration boundary. Replace this adapter with the chosen authentication SDK.
// Credentials are deliberately neither persisted nor sent while the service is unconfigured.
export type GitProvider = "github" | "gitee" | "gitlab";
export type AuthIntent = "login" | "register" | "reset";
export const authCapabilities = { configured: true } as const;

export async function beginGitSignIn(provider: GitProvider): Promise<{ ok: false; message: string }> {
  if (provider === 'github') { window.location.assign('/api/auth/github'); return { ok: false, message: '正在跳转 GitHub 授权…' }; }
  const name = { github: "GitHub", gitee: "Gitee", gitlab: "GitLab" }[provider];
  return { ok: false, message: `${name} 授权登录尚未开通。你可以先体验演示工作台。` };
}

export async function submitEmailAuth(intent: AuthIntent, fields: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const response = await fetch('/api/auth/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: intent, ...fields }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '账号请求失败。');
  if (intent === 'login' && result.ok) window.location.assign('/overview');
  return result;
}
