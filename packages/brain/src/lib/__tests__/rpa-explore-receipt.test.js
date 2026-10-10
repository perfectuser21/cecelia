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

  describe('非探路阶段回执的业务结论（任务 c244dd02）', () => {
    const trial = (extra) => ({ text: JSON.stringify({ stage: 'trial', ...extra }) });
    it('trial + blocked + fail_reason 字符串 → agent_receipt_blocked 带原因', () => {
      expect(rpaExploreFailure(task, trial({ claimed_result: 'blocked', fail_reason: '账号被风控' }))).toBe('agent_receipt_blocked: 账号被风控');
    });
    it('原因在 result 字段（无 fail_reason）→ 带 result 内容', () => {
      expect(rpaExploreFailure(task, trial({ claimed_result: 'blocked', result: '抖音要求滑块验证' }))).toBe('agent_receipt_blocked: 抖音要求滑块验证');
    });
    it('fail_reason 是 {message} 对象 → 取 message', () => {
      expect(rpaExploreFailure(task, trial({ claimed_result: 'blocked', fail_reason: { message: 'x' } }))).toBe('agent_receipt_blocked: x');
    });
    it('trial + success → null（保持完成）', () => {
      expect(rpaExploreFailure(task, trial({ claimed_result: 'success' }))).toBeNull();
    });
    it('trial + failed → agent_receipt_failed', () => {
      expect(rpaExploreFailure(task, trial({ claimed_result: 'failed' }))).toBe('agent_receipt_failed');
    });
    it('claimed_result 是怪值 maybe → agent_receipt_invalid_result', () => {
      expect(rpaExploreFailure(task, trial({ claimed_result: 'maybe', fail_reason: '不确定' }))).toBe('agent_receipt_invalid_result: 不确定');
    });
    it('回执是普通 markdown（非 JSON）→ null，行为不变', () => {
      expect(rpaExploreFailure(task, { text: '## 结论\n采集已完成，blocked 字样只是正文' })).toBeNull();
    });
    it('JSON 但没有 claimed_result → null', () => {
      expect(rpaExploreFailure(task, trial({ verdict: 'pass' }))).toBeNull();
    });
    it('department 不是 skill-factory + blocked → null', () => {
      expect(rpaExploreFailure({ ...task, payload: { qiumi_department: 'dev' } }, trial({ claimed_result: 'blocked', fail_reason: 'x' }))).toBeNull();
    });
    it('explore 阶段不受影响：blocked 仍是 rpa_explore_blocked', () => {
      const report = { stage: 'explore', run_id: task.run_id, claimed_result: 'blocked', fail_reason: '未登录' };
      expect(rpaExploreFailure(task, { text: JSON.stringify(report) })).toBe('rpa_explore_blocked: 未登录');
    });
    it('```json 围栏包裹的 trial blocked 也能识别', () => {
      const text = `\`\`\`json\n${JSON.stringify({ stage: 'trial', claimed_result: 'blocked', fail_reason: '围栏内' })}\n\`\`\``;
      expect(rpaExploreFailure(task, { text })).toBe('agent_receipt_blocked: 围栏内');
    });
    it('detail 超长截到 400 字符', () => {
      const reason = rpaExploreFailure(task, trial({ claimed_result: 'blocked', fail_reason: 'a'.repeat(1000) }));
      expect(reason).toBe(`agent_receipt_blocked: ${'a'.repeat(400)}`);
    });
  });
});
