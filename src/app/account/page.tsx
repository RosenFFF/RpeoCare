'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/features/workbench/client';
import '@/features/workbench/workbench.css';

export default function AccountPage() {
  const [token, setToken] = useState(''), [purpose, setPurpose] = useState(''), [password, setPassword] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { const query = new URLSearchParams(location.search); setToken(query.get('token') || ''); setPurpose(query.get('purpose') || ''); window.history.replaceState(null, '', '/account'); }, []);
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); try { const response = await api<{ message: string }>('/api/auth/email', { action: purpose === 'verify' ? 'verify' : 'reset-confirm', token, ...(purpose === 'reset' ? { password } : {}) }); setMessage(response.message); setToken(''); setPassword(''); } catch (cause) { setMessage((cause as Error).message); } finally { setBusy(false); } }
  return <main className="wb-page" style={{ maxWidth: 560, padding: 30 }}><h1>{purpose === 'verify' ? '验证邮箱' : '重置密码'}</h1><form className="wb-card" onSubmit={submit}>{purpose === 'reset' && <label>新密码<input type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label>}<div className="wb-actions"><button className="button button-primary" disabled={busy || !token}>{busy ? '正在处理…' : '确认'}</button></div></form>{message && <p role="status">{message}</p>}<Link href="/?auth=login">返回登录</Link></main>;
}
