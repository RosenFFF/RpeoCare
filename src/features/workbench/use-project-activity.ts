'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ProjectActivity } from '@/contracts/activity';
import { api } from './client';

const keyOf = (item: ProjectActivity['items'][number]) => `${item.id}:${item.revision}`;
export function useProjectActivity(repoUrl?: string, branch = '') {
  const [data, setData] = useState<ProjectActivity | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [seen, setSeen] = useState<{ scope: string; keys: string[] }>({ scope: '', keys: [] });
  const sequence = useRef(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let disposed = false;
    async function read() {
      const request = ++sequence.current;
      try {
        const value = await api<ProjectActivity>('/api/workbench/activity');
        if (!disposed && request === sequence.current) { setData(value); setError(''); }
      } catch {
        if (!disposed && request === sequence.current) { setData(null); setError('暂时无法读取维护待办，已有任务仍可在原页面查看。'); }
      }
    }
    const changed = () => { setData(null); void read(); };
    const focus = () => { if (!document.hidden) void read(); };
    void read();
    const timer = window.setInterval(focus, 10000);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    window.addEventListener('repocare-project-change', changed);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); window.removeEventListener('repocare-project-change', changed); };
  }, [repoUrl, branch, revision]);
  const current = data?.repoUrl === (repoUrl || null) && data.branch === branch ? data : null;
  const scope = current?.scope || '';
  useEffect(() => {
    if (!scope) return;
    const load = () => {
      try {
        const keys: unknown = JSON.parse(localStorage.getItem(`repocare.activity.v1:${scope}`) || '[]');
        setSeen({ scope, keys: Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string').slice(-200) : [] });
      } catch { setSeen({ scope, keys: [] }); }
    };
    load();
    const sync = (event: StorageEvent) => { if (event.key === null || event.key === `repocare.activity.v1:${scope}`) load(); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [scope]);
  const unread = current && seen.scope === scope ? current.items.filter(item => !seen.keys.includes(keyOf(item))).length : 0;
  const markRead = () => {
    if (!current?.scope) return;
    const keys = [...new Set([...(seen.scope === scope ? seen.keys : []), ...current.items.map(keyOf)])].slice(-200);
    setSeen({ scope, keys });
    try { localStorage.setItem(`repocare.activity.v1:${scope}`, JSON.stringify(keys)); } catch { /* Reading remains available when browser storage is disabled. */ }
  };
  return { data: current, error, refresh, unread, markRead };
}

export type ActivityFeed = ReturnType<typeof useProjectActivity>;
export const ProjectActivityContext = createContext<ActivityFeed | null>(null);
export const useActivityFeed = () => useContext(ProjectActivityContext);
