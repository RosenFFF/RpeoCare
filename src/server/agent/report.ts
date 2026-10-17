import { z } from 'zod';
import type { MaintenanceTask } from '../../contracts/agent';

export const maintenanceReportSchema = z.object({ summary: z.string().min(1).max(2000), findings: z.array(z.object({ title: z.string().max(200), detail: z.string().max(2000), certainty: z.enum(['supported', 'hypothesis']), evidenceIds: z.array(z.string()).max(12) }).strict()).max(12), missingInformation: z.array(z.string().max(600)).max(12), nextSteps: z.array(z.string().max(600)).max(12), scopeLimitations: z.array(z.string().trim().min(1).max(600)).max(12).optional() }).strict();

export function checkedMaintenanceReport(value: unknown, task: MaintenanceTask) {
  const report = maintenanceReportSchema.parse(value);
  for (const finding of report.findings) {
    if (finding.evidenceIds.some(id => !task.evidence.some(evidence => evidence.id === id)) || finding.certainty === 'supported' && !finding.evidenceIds.length) {
      throw new Error(`报告 evidenceIds 只能使用当前证据编号，不能填补丁或验证交付物 UUID。可用编号：${task.evidence.map(evidence => evidence.id).join('、')}。交付状态可写在 summary 中。`);
    }
  }
  return report;
}

/** SDK user messages can contain text blocks; delivery must not depend on string-only content. */
export function deliveredDialogueIds(messages: { role: string; content: unknown }[], injected: Set<string>) {
  const texts = messages.filter(message => message.role === 'user').map(message => typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.filter(block => block?.type === 'text').map(block => block.text).join('\n') : '');
  return [...injected].filter(id => texts.some(text => text.includes(`[message:${id}]`)));
}
