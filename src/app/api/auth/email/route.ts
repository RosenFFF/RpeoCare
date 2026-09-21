import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureSameOrigin, errorResponse, jsonResponse, smallJson } from '@/server/audit/http';
import { login, rateLimit, redeem, register, requestReset } from '@/server/auth/email';

export async function POST(request: NextRequest) {
  try {
    ensureSameOrigin(request);
    // Public deployments must rate-limit the real source IP at the reverse proxy too.
    rateLimit('email-endpoint-global', 200);
    const input = z.discriminatedUnion('action', [
      z.object({ action: z.literal('register'), email: z.string().email().max(254), name: z.string().trim().min(2).max(40), password: z.string().min(10).max(128) }),
      z.object({ action: z.literal('login'), email: z.string().email().max(254), password: z.string().min(1).max(128) }),
      z.object({ action: z.literal('reset'), email: z.string().email().max(254) }),
      z.object({ action: z.literal('verify'), token: z.string().regex(/^[a-f0-9]{64}$/) }),
      z.object({ action: z.literal('reset-confirm'), token: z.string().regex(/^[a-f0-9]{64}$/), password: z.string().min(10).max(128) }),
    ]).parse(await smallJson(request));
    if (input.action === 'verify' || input.action === 'reset-confirm') { await redeem(input.token, input.action === 'verify' ? 'verify' : 'reset', 'password' in input ? input.password : undefined); return jsonResponse({ ok: true, message: '已完成，请返回登录。' }); }
    const email = input.email.trim().toLowerCase();
    if (input.action === 'register') { await register(email, input.name, input.password); return jsonResponse({ ok: true, message: '若该邮箱可用于注册，验证邮件已发送，请检查邮箱。' }); }
    if (input.action === 'reset') { await requestReset(email); return jsonResponse({ ok: true, message: '若账户存在且已验证，重置邮件已发送。' }); }
    const token = await login(email, input.password), response = jsonResponse({ ok: true, message: '登录成功。' });
    response.cookies.set('repocare_login', token, { httpOnly: true, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:', path: '/', maxAge: 30 * 86400 }); return response;
  } catch (error) { return errorResponse(error instanceof z.ZodError ? '请检查邮箱及字段，注册和新密码至少 10 位。' : error instanceof Error ? error.message : '账号操作未完成。'); }
}
