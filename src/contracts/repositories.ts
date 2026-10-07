export interface GithubRepositoryChoice {
  id: number;
  fullName: string;
  url: string;
  description: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  owned: boolean;
  permission: 'admin' | 'maintain' | 'write' | 'read' | 'unknown';
}
export interface GithubRepositoryPage {
  repositories: GithubRepositoryChoice[];
  page: number;
  hasMore: boolean;
  login: string;
  privateAccessAuthorized: boolean;
}
