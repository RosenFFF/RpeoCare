// Frontend integration boundary. Replace this adapter with the chosen authentication SDK.
// Credentials are deliberately neither persisted nor sent while the service is unconfigured.
export type GitProvider = "github" | "gitee" | "gitlab";
export type AuthIntent = "login" | "register" | "reset";
export const authCapabilities = { configured: false } as const;

export async function beginGitSignIn(provider: GitProvider): Promise<{ ok: false; message: string }> {
  const name = { github: "GitHub", gitee: "Gitee", gitlab: "GitLab" }[provider];
  return { ok: false, message: `${name} 授权登录尚未开通。你可以先体验演示工作台。` };
}

export async function submitEmailAuth(intent: AuthIntent): Promise<{ ok: false; message: string }> {
  const message = intent === "register"
    ? "邮箱注册尚未开通，未创建账号，也未保存你的邮箱或密码。"
    : intent === "reset"
      ? "密码重置尚未开通，未发送重置邮件。"
      : "邮箱登录尚未开通。你可以先体验演示工作台。";
  return { ok: false, message };
}
