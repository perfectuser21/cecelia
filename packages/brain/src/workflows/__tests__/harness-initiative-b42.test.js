import { describe, it, expect, vi } from 'vitest';
import { _waitForSubGraphCompletion } from '../harness-initiative.graph.js';

// B42: liveness checker 在 sub-graph 已离开 await_callback 时不应触发
// 根因：容器 exit(0) 正常完成后，sub-graph 已处理 callback 继续运行下一轮，
//       liveness checker 误判 container_exited_without_callback → resume with failure
//       → getState() 返回 status='queued'（默认值）→ serial gate 误报
describe('_waitForSubGraphCompletion — B42 liveness race guard', () => {
  it('state.next 不含 await_callback 时，跳过 liveness check', async () => {
    const livenessCheck = vi.fn(async () => 'container_exited_without_callback');

    let call = 0;
    const compiled = {
      getState: vi.fn(async () => {
        call++;
        if (call === 1) {
          // sub-graph 正在 poll_ci（已离开 await_callback），旧容器已退出
          return {
            next: ['poll_ci'],
            values: {
              containerId: 'harness-task-ws1-r0-abc123',
              pr_url: 'https://github.com/org/repo/pull/490',
              status: 'queued',
            },
          };
        }
        // 第二次 poll：sub-graph 完成
        return { next: [], values: { status: 'merged' } };
      }),
    };

    const result = await _waitForSubGraphCompletion(compiled, {}, 30000, {
      pollIntervalMs: 1,
      livenessCheckEveryN: 1,
      _checkLiveness: livenessCheck,
    });

    // B42: 守卫生效 — liveness check 不应被调用
    expect(livenessCheck).not.toHaveBeenCalled();
    expect(result.status).toBe('merged');
  });

  it('state.next 含 await_callback 且容器已死时，正常触发 liveness check', async () => {
    const livenessCheck = vi.fn(async () => 'container_exited_without_callback');
    const prMergedCheck = vi.fn(async () => false);

    let call = 0;
    const compiled = {
      getState: vi.fn(async () => {
        call++;
        if (call === 1) {
          return {
            next: ['await_callback'],
            values: {
              containerId: 'harness-task-ws1-r0-dead',
              pr_url: 'https://github.com/org/repo/pull/490',
              status: 'queued',
            },
          };
        }
        return { next: [], values: { status: 'failed' } };
      }),
      invoke: vi.fn(async () => {}),
    };

    const result = await _waitForSubGraphCompletion(compiled, {}, 30000, {
      pollIntervalMs: 1,
      livenessCheckEveryN: 1,
      _checkLiveness: livenessCheck,
      _checkPrMerged: prMergedCheck,
    });

    expect(livenessCheck).toHaveBeenCalledWith('harness-task-ws1-r0-dead');
    expect(result.status).toBe('failed');
  });

  it('await_callback + 容器已死 + PR 已 merged → 返回 merged', async () => {
    const livenessCheck = vi.fn(async () => 'container_exited_without_callback');
    const prMergedCheck = vi.fn(async () => true);

    const compiled = {
      getState: vi.fn(async () => ({
        next: ['await_callback'],
        values: {
          containerId: 'harness-task-ws1-r0-done',
          pr_url: 'https://github.com/org/repo/pull/490',
          status: 'queued',
        },
      })),
      invoke: vi.fn(async () => {}),
    };

    const result = await _waitForSubGraphCompletion(compiled, {}, 30000, {
      pollIntervalMs: 1,
      livenessCheckEveryN: 1,
      _checkLiveness: livenessCheck,
      _checkPrMerged: prMergedCheck,
    });

    expect(result.status).toBe('merged');
  });
});
