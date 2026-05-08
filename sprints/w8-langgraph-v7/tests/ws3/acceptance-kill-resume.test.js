/**
 * W8 Acceptance v7 — Workstream 3
 * BEHAVIOR：14 节点图上的 kill-resume 实证（resume 续跑 + 节点幂等 + brain_tasks 终态）
 *
 * 红阶段证据：import 'acceptance/kill-resume-runner.js' 失败（模块未实现）。
 * Generator 实现后必须满足以下 5 条 it()（含 hook 精准触发 BEHAVIOR）。
 */
import { describe, it, expect } from 'vitest';

const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed']);

describe('W8 Acceptance v7 / WS3 — kill-resume runner on 14-node graph [BEHAVIOR]', () => {
  it("在 'evaluate' 节点完成后中断子进程，再用同 threadId resume，最终 task 状态 ∈ {completed, failed}", async () => {
    const { runWithKillAfterNode } = await import(
      '../../../../packages/brain/src/workflows/acceptance/kill-resume-runner.js'
    );
    const result = await runWithKillAfterNode({
      taskId: '00000000-0000-0000-0000-000000000020',
      threadId: 'ws3-kill-resume-evaluate',
      killAfterNode: 'evaluate',
      minimal: true,
    });
    expect(result.resumed).toBe(true);
    expect(TERMINAL_TASK_STATUSES.has(result.finalTaskStatus)).toBe(true);
  });

  it('resume 后 dev_records 表针对本 task_id 行数恰好 1（节点幂等门生效）', async () => {
    const { runWithKillAfterNode } = await import(
      '../../../../packages/brain/src/workflows/acceptance/kill-resume-runner.js'
    );
    const taskId = '00000000-0000-0000-0000-000000000021';
    const result = await runWithKillAfterNode({
      taskId,
      threadId: 'ws3-kill-resume-idempotent',
      killAfterNode: 'evaluate',
      minimal: true,
    });
    expect(result.devRecordsCount).toBe(1);
    expect(result.duplicateSideEffectDetected).toBe(false);
  });

  it('resume 后 brain_tasks 子任务行数 = inferTaskPlan 切出的子任务数（不重复 upsert）', async () => {
    const { runWithKillAfterNode } = await import(
      '../../../../packages/brain/src/workflows/acceptance/kill-resume-runner.js'
    );
    const result = await runWithKillAfterNode({
      taskId: '00000000-0000-0000-0000-000000000022',
      threadId: 'ws3-kill-resume-subtasks',
      killAfterNode: 'evaluate',
      minimal: true,
    });
    expect(result.subTasksPlanned).toBeGreaterThanOrEqual(1);
    expect(result.subTasksUpserted).toBe(result.subTasksPlanned);
  });

  it("kill 由 LangGraph node-exit hook 触发（非 sleep 时间近似）：result.killTrigger === 'node-exit-hook' 且 result.killNode === 'evaluate'", async () => {
    const { runWithKillAfterNode } = await import(
      '../../../../packages/brain/src/workflows/acceptance/kill-resume-runner.js'
    );
    const result = await runWithKillAfterNode({
      taskId: '00000000-0000-0000-0000-000000000024',
      threadId: 'ws3-kill-resume-hook-precise',
      killAfterNode: 'evaluate',
      minimal: true,
    });
    expect(result.killTrigger).toBe('node-exit-hook');
    expect(result.killNode).toBe('evaluate');
    expect(result.killTimingLine).toBe('KILL_TIMING: evaluate');
  });

  it('runWithKillAfterNode 在传入未知节点名时抛 UnknownNodeError（不静默通过）', async () => {
    const { runWithKillAfterNode } = await import(
      '../../../../packages/brain/src/workflows/acceptance/kill-resume-runner.js'
    );
    await expect(
      runWithKillAfterNode({
        taskId: '00000000-0000-0000-0000-000000000023',
        threadId: 'ws3-kill-resume-bad-node',
        killAfterNode: 'this_node_does_not_exist',
        minimal: true,
      })
    ).rejects.toThrow(/UnknownNodeError|unknown.*node/i);
  });
});
