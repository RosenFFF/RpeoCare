'use client';

import type { GitItem } from '@/contracts/workbench';
import { IssueTerrain } from './issue-terrain';
import { PullVoyage } from './pull-voyage';

type Props = {
  kind: 'issues' | 'pulls';
  items: GitItem[];
  busy: boolean;
  onOpen: (item: GitItem) => void;
};

export function MaintenancePulse({ kind, items, busy, onOpen }: Props) {
  return kind === 'issues' ? <IssueTerrain items={items} busy={busy} onOpen={onOpen} /> : <PullVoyage items={items} busy={busy} onOpen={onOpen} />;
}
