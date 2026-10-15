'use client';

import type { GitItem } from '@/contracts/workbench';
import { IssueWorkMap } from './issue-work-map';
import { PullVoyage } from './pull-voyage';
import type { IssueMapSignals } from './issue-visual-signals';

type Props = {
  kind: 'issues' | 'pulls';
  items: GitItem[];
  busy: boolean;
  onOpen: (item: GitItem) => void;
  signals: IssueMapSignals;
  baseBranch?: string;
};

export function MaintenancePulse({ kind, items, busy, onOpen, signals, baseBranch }: Props) {
  return kind === 'issues' ? <IssueWorkMap items={items} busy={busy} onOpen={onOpen} signals={signals} /> : <PullVoyage baseBranch={baseBranch} items={items} busy={busy} onOpen={onOpen} />;
}
