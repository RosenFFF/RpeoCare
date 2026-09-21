'use client';
import { useEffect, useState } from 'react';
import type { ChatMessage } from '@/contracts/workbench';
import { api } from './client';
import './workbench.css';

export function ReportChat({ runId }: { runId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]), [input, setInput] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { let disposed = false; void api<{ messages: ChatMessage[] }>(`/api/workbench/chat?runId=${runId}`).then(value => { if (!disposed) setMessages(value.messages); }).catch(cause => { if (!disposed) setError(cause.message); }); return () => { disposed = true; }; }, [runId]);
  async function send(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { setMessages((await api<{ messages: ChatMessage[] }>('/api/workbench/chat', { runId, message: input })).messages); setInput(''); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }
  return <section className="wb-chat"><h3>继续讨论这份报告</h3><p>可以追问依据、解释建议或讨论修改方式。回答基于本次快照，AI 回复仍需核对。</p>{messages.map((message, index) => <article key={`${message.at}-${index}`}><strong>{message.role === 'user' ? '你' : 'RepoCare'}</strong>{message.content}</article>)}<form onSubmit={send}><textarea aria-label="报告追问" placeholder="例如：为什么需要补充贡献指南？" required maxLength={2000} disabled={busy} value={input} onChange={event => setInput(event.target.value)} /><button className="button button-primary" disabled={busy}>{busy ? '正在回答…' : '发送追问'}</button></form>{error && <p className="wb-error" role="alert">{error}</p>}</section>;
}
