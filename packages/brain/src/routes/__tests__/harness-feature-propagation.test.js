import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('execution.js feature_id 传播 — 代码审查测试', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'packages/brain/src/routes/execution.js'),
    'utf8'
  );

  it('harness_contract_propose（planner→propose，round=1）payload 含 feature_id 字段', () => {
    // propose_round: 1 紧接在 planner 完成后创建的 propose 任务中
    const idx = src.indexOf('propose_round: 1,');
    expect(idx).toBeGreaterThan(0);
    const nearbyCode = src.slice(Math.max(0, idx - 200), idx + 600);
    expect(nearbyCode).toContain('feature_id');
  });

  it('harness_contract_review（propose→review）payload 含 feature_id 字段', () => {
    // propose_task_id 是 review payload 中的唯一标识字段
    const idx = src.indexOf('propose_task_id: task_id,');
    expect(idx).toBeGreaterThan(0);
    const nearbyCode = src.slice(Math.max(0, idx - 200), idx + 600);
    expect(nearbyCode).toContain('feature_id');
  });

  it('harness_contract_propose（review REVISION → 下一轮 propose）payload 含 feature_id 字段', () => {
    // review_feedback_task_id 是下一轮 propose payload 中的标识字段
    const idx = src.indexOf('review_feedback_task_id: task_id,');
    expect(idx).toBeGreaterThan(0);
    const nearbyCode = src.slice(Math.max(0, idx - 200), idx + 600);
    expect(nearbyCode).toContain('feature_id');
  });

  it('harness_evaluate（generate 完成后，eval_round: 1）payload 含 feature_id 字段', () => {
    // project_id: harnessTask.project_id + eval_round: 1 是 generate→evaluate 的特征
    const idx = src.indexOf('project_id: harnessTask.project_id,\n                  eval_round: 1,');
    expect(idx).toBeGreaterThan(0);
    const nearbyCode = src.slice(Math.max(0, idx - 200), idx + 600);
    expect(nearbyCode).toContain('feature_id');
  });

  it('harness_evaluate（fix 完成后，eval_round: evalRound + 1）payload 含 feature_id 字段', () => {
    // eval_round: evalRound + 1 是 fix→evaluate 的特征字段
    const idx = src.indexOf('eval_round: evalRound + 1,\n                harness_mode: true');
    expect(idx).toBeGreaterThan(0);
    const nearbyCode = src.slice(Math.max(0, idx - 200), idx + 600);
    expect(nearbyCode).toContain('feature_id');
  });
});
