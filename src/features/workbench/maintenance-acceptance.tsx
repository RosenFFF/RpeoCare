'use client';

import { useId, useState } from 'react';
import type { AgentArtifact, MaintenanceTask } from '@/contracts/agent';

export function MaintenanceAcceptance({ artifact, task, disabled, action }: {
  artifact: AgentArtifact; task: MaintenanceTask; disabled: boolean; action: (body: unknown) => Promise<boolean>;
}) {
  const id = useId();
  const [content, setContent] = useState('');
  const [note, setNote] = useState('');
  const [declaration, setDeclaration] = useState<'withheld' | 'reviewed-candidate'>('reviewed-candidate');
  const [normalTests, setNormalTests] = useState('test_normal_behavior');
  const [error, setError] = useState('');
  const [setup, setSetup] = useState('');
  const [targets, setTargets] = useState(() => artifact.verification!.requirements.map((requirement, index) => ({ requirementId: requirement.id, selected: true, testName: `test_requirement_${index + 1}`, failureSignal: '' })));
  return <details className="mv-acceptance-form"><summary>添加人工验收测试</summary>
    <p>保留原方案，另建同测试的两版对照。至少选择一条要求和一个正常行为用例。保存不会调用模型或执行代码。</p>
    <form onSubmit={async event => {
      event.preventDefault(); setError('');
      const selected = targets.filter(target => target.selected).map(({ selected: _selected, ...target }) => target);
      if (!selected.length) { setError('至少选择一条需要验收的要求。'); return; }
      const ok = await action({ action: 'prepare-acceptance', id: task.id, artifactId: artifact.id, fingerprint: artifact.verification!.fingerprint, updatedAt: task.updatedAt,
        content, note, declaration, targets: selected, normalTests: normalTests.split(/[，,\s]+/).filter(Boolean), ...(setup.trim() ? { setupCommands: setup.split('\n').map(line => line.trim()).filter(Boolean) } : {}) });
      if (ok) { setContent(''); setNote(''); }
    }}>
      <label htmlFor={`${id}-content`}>pytest 测试内容<textarea id={`${id}-content`} value={content} onChange={event => setContent(event.target.value)} required minLength={10} maxLength={20000} rows={10} spellCheck={false} placeholder="粘贴顶层 test_ 函数，导入原项目公开接口；目标断言需包含可核对的失败标记…" /></label>
      <label htmlFor={`${id}-file`}>或读取本地 .py 文件<input id={`${id}-file`} type="file" accept=".py" onChange={async event => {
        const file = event.target.files?.[0]; if (!file) return;
        if (file.size > 20000) { setError('文件最多 20KB。'); return; }
        try { setContent(await file.text()); setError(''); } catch { setError('文件未能读取，请重新选择。'); }
      }} /></label>
      <fieldset><legend>要求与目标测试</legend>{targets.map((target, index) => <div className="mv-acceptance-target" key={target.requirementId}>
        <label><input type="checkbox" checked={target.selected} onChange={event => setTargets(values => values.map((value, i) => i === index ? { ...value, selected: event.target.checked } : value))} />{artifact.verification!.requirements[index].text}</label>
        {target.selected && <><label htmlFor={`${id}-test-${index}`}>测试函数名<input id={`${id}-test-${index}`} required pattern="test_[A-Za-z0-9_]+" value={target.testName} onChange={event => setTargets(values => values.map((value, i) => i === index ? { ...value, testName: event.target.value } : value))} /></label>
          <label htmlFor={`${id}-signal-${index}`}>原版预期失败标记<input id={`${id}-signal-${index}`} required minLength={5} maxLength={200} value={target.failureSignal} onChange={event => setTargets(values => values.map((value, i) => i === index ? { ...value, failureSignal: event.target.value } : value))} placeholder="例如断言中实际出现的 VALUE_EXPECTED…" /></label></>}
      </div>)}</fieldset>
      <label htmlFor={`${id}-normal`}>正常行为测试函数名<input id={`${id}-normal`} required value={normalTests} onChange={event => setNormalTests(event.target.value)} placeholder="test_normal_behavior，多个用逗号分隔…" /></label>
      <label htmlFor={`${id}-note`}>来源与覆盖范围<textarea id={`${id}-note`} required minLength={8} maxLength={500} rows={2} value={note} onChange={event => setNote(event.target.value)} placeholder="说明测试由谁提供、依据何种要求、覆盖哪些边界…" /></label>
      <label htmlFor={`${id}-declaration`}>测试来源声明<select id={`${id}-declaration`} value={declaration} onChange={event => setDeclaration(event.target.value as typeof declaration)}><option value="reviewed-candidate">提供者已看过候选，或独立性未知</option><option value="withheld">声明这些测试未提供给生成候选的模型</option></select></label>
      <details><summary>依赖准备（原计划缺少时填写）</summary><label htmlFor={`${id}-setup`}>依据仓库声明的准备命令<textarea id={`${id}-setup`} rows={3} maxLength={2000} value={setup} onChange={event => setSetup(event.target.value)} placeholder="每行一条受支持的 pip 准备命令；留空沿用原计划…" /></label><p>命令经过相同的校验与环境预检，保存后仍须逐条审阅。不会在宿主机安装依赖。</p></details>
      <p>系统保存你的声明和实际执行依据，无法据此证明独立作者身份或盲测条件。测试也需要审阅，执行仍使用隔离 Runner。</p>
      {error && <p role="alert">{error}</p>}<button type="submit" className="button button-secondary" disabled={disabled}>保存待审阅的验收方案</button>
    </form>
  </details>;
}
