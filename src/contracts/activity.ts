export type ActivityState = 'attention' | 'review' | 'running' | 'complete';
export interface ActivityItem {
  id: string;
  revision: string;
  title: string;
  detail: string;
  href: string;
  action: string;
  state: ActivityState;
  updatedAt: string;
}
export interface ProjectActivity {
  scope: string;
  repoUrl: string | null;
  branch: string;
  items: ActivityItem[];
  modelConfigured: boolean;
  workerOnline: boolean;
  sandboxConfigured: boolean;
  reproductionWorkerOnline: boolean;
}
