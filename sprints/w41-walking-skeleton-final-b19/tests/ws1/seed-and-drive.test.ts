import { describe, it, expect } from 'vitest';

describe('Workstream 1 — seed + drive 模块 [BEHAVIOR]', () => {
  it('seed-w41-demo-task.js 导出 buildDemoTaskPayload() 返回 task_type 以 harness_ 开头', async () => {
    const mod: any = await import('../../../../packages/brain/scripts/seed-w41-demo-task.js');
    expect(typeof mod.buildDemoTaskPayload).toBe('function');
    const payload = mod.buildDemoTaskPayload();
    expect(payload).toHaveProperty('task_type');
    expect(String(payload.task_type)).toMatch(/^harness_/);
    expect(payload).toHaveProperty('payload');
    expect(payload.payload).toHaveProperty('sprint_dir');
  });

  it('seed-w41-demo-task.js 演练 spec 设计成第 1 轮 FAIL 第 2 轮 PASS（含 markerForFixLoop=true）', async () => {
    const mod: any = await import('../../../../packages/brain/scripts/seed-w41-demo-task.js');
    const payload = mod.buildDemoTaskPayload();
    expect(payload.payload).toHaveProperty('markerForFixLoop', true);
  });

  it('drive-w41-e2e.js 导出 collectEvidence() 返回包含 5 个键的对象', async () => {
    const mod: any = await import('../../../../packages/brain/scripts/drive-w41-e2e.js');
    expect(typeof mod.collectEvidence).toBe('function');
    const keys = mod.evidenceFileNames ? mod.evidenceFileNames() : [];
    expect(keys).toEqual(
      expect.arrayContaining([
        'seed-output.json',
        'pr-url-trace.txt',
        'evaluator-checkout-proof.txt',
        'dispatch-events.csv',
        'brain-log-excerpt.txt',
      ])
    );
  });

  it('drive-w41-e2e.js 导出 waitForCompletion(taskId, opts) 函数（轮询直到 status=completed 或超时）', async () => {
    const mod: any = await import('../../../../packages/brain/scripts/drive-w41-e2e.js');
    expect(typeof mod.waitForCompletion).toBe('function');
  });
});
