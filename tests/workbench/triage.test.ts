import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTriage } from '../../src/server/workbench/triage';
import type { GitItem } from '../../src/contracts/workbench';

const item: GitItem = {
  number: 42, title: 'Empty CSV raises IndexError', body: 'It crashes.', url: 'https://github.com/example/project/issues/42',
  state: 'open', author: 'reporter', updatedAt: '2026-09-29T00:00:00Z', labels: [],
  comments: [{ id: 7, body: 'Please help', url: 'https://github.com/example/project/issues/42#issuecomment-7', author: 'maintainer', createdAt: '2026-09-29T01:00:00Z', updatedAt: '2026-09-29T01:00:00Z' }],
};

test('parses fenced triage JSON, maps workflow status and keeps only real comments', () => {
  const result = parseTriage(`\n\`\`\`json\n${JSON.stringify({
    category: 'bug', priority: 'high', confidence: 'high', needsMoreInfo: true, language: 'English',
    titleZh: '上传空 CSV 时发生 IndexError', summaryZh: '需要补充复现信息。', bodyZh: '上传空 CSV 文件时崩溃。',
    actualBehavior: '抛出 IndexError', expectedBehavior: '正常处理空文件', environment: '未提供',
    providedInformation: ['空 CSV 会触发崩溃'], missingInformation: ['错误堆栈'], suggestedLabels: ['bug'],
    suggestedAction: 'request-information', commentsZh: [{ id: 7, bodyZh: '请提供更多信息。' }, { id: 99, bodyZh: '不应被保存。' }],
  })}\n\`\`\``, item);
  assert.equal(result.category, 'bug');
  assert.equal(result.workflowStatus, 'needs-info');
  assert.deepEqual(result.commentsZh, [{ id: 7, bodyZh: '请提供更多信息。' }]);
});

test('rejects non-JSON or incomplete model triage output', () => {
  assert.throws(() => parseTriage('not-json', item), /有效 JSON/);
  assert.throws(() => parseTriage(JSON.stringify({ category: 'bug' }), item), /字段不完整|问题类型|优先级/);
  assert.throws(() => parseTriage(JSON.stringify({ category: 'invalid' }), item), /问题类型/);
});

test('computes issue readiness and separates ready-to-reproduce from reply status', () => {
  const result = parseTriage(JSON.stringify({
    category: 'bug', priority: 'medium', confidence: 'high', needsMoreInfo: false, language: 'English',
    titleZh: '提交按钮失败', summaryZh: '固定步骤下可以调查该问题。', bodyZh: '提交表单后返回错误。',
    actualBehavior: '点击提交后返回 500', expectedBehavior: '提交成功并跳转到结果页', environment: 'Node.js 24、Chrome 版本 120',
    providedInformation: ['页面地址 /login', '按钮文本为提交', '错误状态为 500'], missingInformation: [], suggestedLabels: ['bug'],
    suggestedAction: 'investigate', commentsZh: [],
  }), { ...item, title: 'Submit button returns 500', body: 'The submit button returns 500 after entering valid credentials.' });
  assert.equal(result.readinessLevel, 'ready');
  assert.equal(result.workflowStatus, 'ready-to-reproduce');
  assert.ok((result.readinessScore || 0) >= 75);
  assert.equal(result.readinessBlockers?.length, 0);
  assert.ok(result.rationale?.length);
});
