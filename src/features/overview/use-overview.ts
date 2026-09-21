'use client';

import { useEffect, useState } from 'react';
import { api } from '@/features/workbench/client';
import type { Overview, RepositoryCounts } from '@/contracts/overview';

export function useOverview() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [counts, setCounts] = useState<RepositoryCounts | null>(null);
  const [countsLoading, setCountsLoading] = useState(false);
  const retry = () => setRevision(value => value + 1);

  useEffect(() => {
    let disposed = false, version = 0;
    async function refresh() {
      const current = ++version;
      try {
        const value = await api<Overview>('/api/workbench/overview');
        if (!disposed && current === version) { setOverview(value); setError(''); }
      } catch (cause) {
        if (!disposed && current === version) setError(cause instanceof Error ? cause.message : '项目概览暂时无法读取。');
      }
    }
    const projectChanged = () => { setOverview(null); void refresh(); };
    void refresh();
    // Also observe a run completed or a project changed in another browser tab.
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    window.addEventListener('repocare-project-change', projectChanged);
    window.addEventListener('focus', refresh);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('repocare-project-change', projectChanged); window.removeEventListener('focus', refresh); };
  }, [revision]);

  const repoUrl = overview?.report ? overview.project?.repoUrl : undefined;
  useEffect(() => {
    let disposed = false, version = 0;
    setCounts(null);
    if (!repoUrl) { setCountsLoading(false); return; }
    async function refresh() {
      const current = ++version;
      setCountsLoading(true);
      try {
        const value = await api<RepositoryCounts>('/api/workbench/counts');
        if (!disposed && current === version) setCounts(value.repoUrl === repoUrl ? value : null);
      } catch {
        if (!disposed && current === version) setCounts(null);
      } finally { if (!disposed && current === version) setCountsLoading(false); }
    }
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { disposed = true; window.removeEventListener('focus', refresh); };
  }, [repoUrl, revision]);

  return { overview, error, retry, counts: counts?.repoUrl === repoUrl ? counts : null, countsLoading };
}
