export interface RepositoryBranch {
  name: string;
  commitSha?: string;
  protected: boolean;
}

export interface BranchDirectory {
  repoUrl: string;
  defaultBranch?: string;
  branches: RepositoryBranch[];
  page: number;
  hasNext: boolean;
}
