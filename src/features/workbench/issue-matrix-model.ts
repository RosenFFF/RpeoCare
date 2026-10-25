import type { GitItem } from '@/contracts/workbench';
import { issueClassification } from './inbox-model';
import { issueDiscussion } from './issue-map-model';
import type { IssueVisualSignal } from './issue-visual-signals';

/** Matrix quadrants: high/low known attention × complete/missing information. */
export type MatrixQuadrant = 'act' | 'clarify' | 'schedule' | 'watch';
export const matrixQuadrants: Record<MatrixQuadrant, { label: string; hint: string }> = {
  act: { label: '立即处理', hint: '关注分高，分诊未记录缺失信息' },
  clarify: { label: '先补信息', hint: '关注分高，但还缺复现步骤、日志等信息' },
  schedule: { label: '可排期', hint: '关注分较低，信息已完整，可按计划处理' },
  watch: { label: '等待反馈', hint: '关注分较低且缺信息，等待提问者补充' },
};
export const matrixQuadrantOrder: MatrixQuadrant[] = ['act', 'clarify', 'schedule', 'watch'];
/** Split line on the 0–100 known-attention scale. A viewing aid, not a severity threshold. */
export const ATTENTION_SPLIT = 40;
const MISSING_CAP = 4;

export type MatrixPoint = { item: GitItem; attention: number; missing: number; quadrant: MatrixQuadrant; stale: boolean; x: number; y: number; r: number; label: 'right' | 'left' | 'hidden' };

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

/** Only saved triage gives the information axis; untriaged issues stay in the tray instead of receiving a guessed position. */
export function matrixMissing(item: GitItem) {
  if (!item.triage) return null;
  const listed = item.triage.missingInformation?.length ?? 0;
  return listed || (item.triage.needsMoreInfo ? 1 : 0);
}

export function matrixQuadrant(attention: number, missing: number): MatrixQuadrant {
  const high = attention >= ATTENTION_SPLIT;
  return missing > 0 ? high ? 'clarify' : 'watch' : high ? 'act' : 'schedule';
}

/**
 * Places triaged issues: x = known attention (0–100), y = information gap
 * (complete in the upper half, more missing items lower). Bubble size follows
 * discussion volume. Deterministic, with light relaxation so bubbles stay clickable.
 */
export function layoutIssueMatrix(items: GitItem[], signals: ReadonlyMap<string, IssueVisualSignal>, width: number, height: number) {
  const pad = { left: 44, right: 28, top: 26, bottom: 34 };
  const plotWidth = Math.max(120, width - pad.left - pad.right);
  const plotHeight = Math.max(120, height - pad.top - pad.bottom);
  const middle = pad.top + plotHeight / 2;
  const tray: { item: GitItem; attention: number }[] = [];
  const points: MatrixPoint[] = [];
  for (const item of items) {
    const attention = signals.get(item.url)?.attention.known ?? 0;
    const missing = matrixMissing(item);
    if (missing === null) { tray.push({ item, attention }); continue; }
    const seed = hash(item.url);
    const jitter = ((seed % 1000) / 1000 - .5);
    const band = plotHeight / 2;
    const y = missing === 0
      ? pad.top + band * (.18 + ((seed >>> 10) % 1000) / 1000 * .64)
      : middle + band * (Math.min(missing, MISSING_CAP) / MISSING_CAP * .74 + .1) + jitter * band * .12;
    const comments = issueDiscussion(item);
    points.push({
      item, attention, missing, quadrant: matrixQuadrant(attention, missing), stale: issueClassification(item).stale,
      x: pad.left + Math.min(100, Math.max(0, attention)) / 100 * plotWidth, y,
      r: 9 + Math.min(9, 3 * Math.log2(1 + (comments ?? 0))), label: 'right',
    });
  }
  if (points.length <= 300) {
    for (let round = 0; round < 30; round++) {
      for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
        const a = points[i], b = points[j];
        const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy) || .01, minimum = a.r + b.r + 4;
        // Labels sit beside bubbles, so near neighbours on one line separate vertically.
        if (Math.abs(dx) < 64 + a.r + b.r && Math.abs(dy) < 16) {
          const lift = (16 - Math.abs(dy)) / 2 + .5, sign = dy >= 0 ? 1 : -1;
          a.y -= sign * lift; b.y += sign * lift;
          continue;
        }
        if (distance >= minimum) continue;
        const push = (minimum - distance) / 2, ux = dx / distance, uy = dy / distance;
        // Keep the attention axis honest: move mostly vertically, inside the bubble's own half.
        a.x -= ux * push * .25; b.x += ux * push * .25; a.y -= uy * push + (dy === 0 ? push : 0); b.y += uy * push;
      }
      for (const point of points) {
        const top = point.missing === 0 ? pad.top + point.r : middle + point.r;
        const bottom = point.missing === 0 ? middle - point.r : pad.top + plotHeight - point.r;
        point.y = Math.min(bottom, Math.max(top, point.y));
        // Never let relaxation carry a bubble across the attention split.
        const split = pad.left + ATTENTION_SPLIT / 100 * plotWidth;
        const left = point.attention >= ATTENTION_SPLIT ? split + 1 : pad.left + point.r;
        const right = point.attention >= ATTENTION_SPLIT ? pad.left + plotWidth - point.r : split - 1;
        point.x = Math.min(Math.max(left, right), Math.max(left, point.x));
      }
    }
  }
  points.forEach(point => { point.x = Math.round(point.x); point.y = Math.round(point.y); });
  // Place each "#number" label on a free side; hide it (it stays in the accessible name and hover card) when both sides collide.
  const labelWidth = (point: MatrixPoint) => String(point.item.number).length * 7 + 14;
  const boxes: { x1: number; x2: number; y1: number; y2: number }[] = points.map(point => ({ x1: point.x - point.r, x2: point.x + point.r, y1: point.y - point.r, y2: point.y + point.r }));
  const free = (box: { x1: number; x2: number; y1: number; y2: number }) => box.x1 >= pad.left && box.x2 <= pad.left + plotWidth && boxes.every(other => box.x2 <= other.x1 || box.x1 >= other.x2 || box.y2 <= other.y1 || box.y1 >= other.y2);
  for (const point of [...points].sort((a, b) => b.attention - a.attention || a.item.number - b.item.number)) {
    const width = labelWidth(point), y1 = point.y - 8, y2 = point.y + 8;
    const right = { x1: point.x + point.r + 3, x2: point.x + point.r + 3 + width, y1, y2 };
    const left = { x1: point.x - point.r - 3 - width, x2: point.x - point.r - 3, y1, y2 };
    point.label = free(right) ? 'right' : free(left) ? 'left' : 'hidden';
    if (point.label !== 'hidden') boxes.push(point.label === 'right' ? right : left);
  }
  tray.sort((a, b) => b.attention - a.attention || a.item.number - b.item.number);
  const counts = Object.fromEntries(matrixQuadrantOrder.map(key => [key, points.filter(point => point.quadrant === key).length])) as Record<MatrixQuadrant, number>;
  return { width, height, pad, plotWidth, plotHeight, middle, splitX: pad.left + ATTENTION_SPLIT / 100 * plotWidth, points, tray, counts };
}
