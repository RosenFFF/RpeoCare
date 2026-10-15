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
};

export function MaintenancePulse({ kind, items, busy, onOpen, signals }: Props) {
  return kind === 'issues' ? <IssueWorkMap items={items} busy={busy} onOpen={onOpen} signals={signals} /> : <PullVoyage items={items} busy={busy} onOpen={onOpen} />;
}
