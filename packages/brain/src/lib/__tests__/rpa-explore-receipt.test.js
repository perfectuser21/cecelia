import { describe, it, expect } from 'vitest';
import { rpaExploreFailure } from '../rpa-explore-receipt.js';

describe('rpa-explore-receipt', () => {
  const task = { run_id: 'original-run', payload: { qiumi_department: 'skill-factory' } };
  it('接受工厂规定的 JSON 代码块格式', () => {
    const report = { stage: 'explore', run_id: task.run_id, claimed_result: 'success', lock_released: true };
    expect(rpaExploreFailure(task, { text: `\`\`\`json\n${JSON.stringify(report)}\n\`\`\`` })).toBeNull();
  });
  it('保留结构化失败原因供员工回执', () => {
    const report = { stage: 'explore', run_id: task.run_id, claimed_result: 'blocked', fail_reason: { message: '账号未登录' } };
    expect(rpaExploreFailure(task, { text: JSON.stringify(report) })).toBe('rpa_explore_blocked: 账号未登录');
  });
  it('不替换其他 Agent 的结果协议', () => {
    expect(rpaExploreFailure({ ...task, payload: { qiumi_department: 'company-kr' } }, { text: '{"stage":"explore","claimed_result":"failed"}' })).toBeNull();
  });
  it('不替换工厂其他阶段的结果协议', () => {
    expect(rpaExploreFailure(task, { text: '{"stage":"verify"}' })).toBeNull();
  });
  it('核验任务引用 skill-explore 名称时不被误认成探路', () => {
    const verify = { ...task, payload: { ...task.payload, qiumi_source: { body: '阶段：核验。使用 skill：run-verify。核验 skill-explore 产出的证据。' } } };
    expect(rpaExploreFailure(verify, { text: '{"stage":"verify","verdict":"pass"}' })).toBeNull();
  });
});
