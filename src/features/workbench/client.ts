'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Workbench } from '@/contracts/workbench';
export async function api<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: 'no-store' } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json().catch(() => ({ error: '服务未返回有效响应，请刷新并检查登录状态。' })); if (!response.ok) throw new Error(value.error || '请求失败，请重试。'); return value;
}
export const changed = () => window.dispatchEvent(new Event('repocare-project-change'));
export function useWorkbench() {
  const [data, setData] = useState<Workbench | null>(null), [error, setError] = useState('');
  const refresh = useCallback(async () => { try { setData(await api<Workbench>('/api/workbench')); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : '加载失败'); } }, []);
  useEffect(() => { void refresh(); const update = () => void refresh(); window.addEventListener('repocare-project-change', update); return () => window.removeEventListener('repocare-project-change', update); }, [refresh]);
  return { data, error, refresh };
}
