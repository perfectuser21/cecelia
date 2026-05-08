import { describe, it, expect, vi } from 'vitest';

// 故意 import 还不存在的 lib 模块，TDD Red 阶段会因 ENOENT/import 失败而 FAIL
// Generator 实现 lib/preflight.mjs 后转 Green
// @ts-expect-error: lib not yet implemented (red phase)
import * as preflight from '../../../harness-acceptance-v3/lib/preflight.mjs';

describe('Workstream 1 — Pre-flight 校验 + Acceptance Initiative 派发 [BEHAVIOR]', () => {
  it('verifyDeployHead() 在 Brain HEAD ≠ origin/main 时抛错', async () => {
    await expect(
      preflight.verifyDeployHead({
        brainHead: 'aaaaaaa1111111111111111111111111111111aa',
        mainHead: 'bbbbbbb2222222222222222222222222222222bb',
      }),
    ).rejects.toThrow(/HEAD mismatch|stale Brain|brain.*main/i);
  });

  it('verifyDeployHead() 相等时返回 HEAD 字符串', async () => {
    const head = 'cccccccc3333333333333333333333333333333333';
    const ret = await preflight.verifyDeployHead({ brainHead: head, mainHead: head });
    expect(ret).toBe(head);
  });

  it('assertNotEmergencyBrake() 当 status=emergency_brake 抛错', async () => {
    await expect(
      preflight.assertNotEmergencyBrake({ brake_state: 'emergency_brake' }),
    ).rejects.toThrow(/emergency_brake/i);
  });

  it('registerAndDispatchAcceptance() payload 含 timeout_sec>=1800 与 initiative_id', async () => {
    const fakeFetch = vi.fn(async (url: string, opts: any) => {
      if (url.endsWith('/api/brain/tasks')) {
        const body = JSON.parse(opts.body);
        expect(body.task_type).toBe('harness_initiative');
        expect(body.priority).toBe('P1');
        expect(body.payload.initiative_id).toBe('harness-acceptance-v3-2026-05-07');
        expect(body.payload.sprint_dir).toBe('sprints/harness-acceptance-v3');
        expect(body.payload.timeout_sec).toBeGreaterThanOrEqual(1800);
        return { ok: true, json: async () => ({ id: 'task-uuid-xyz' }) } as any;
      }
      if (url.includes('/dispatch')) {
        return { ok: true, json: async () => ({ dispatched: true }) } as any;
      }
      return { ok: false, status: 404, json: async () => ({}) } as any;
    });

    const taskId = await preflight.registerAndDispatchAcceptance({ fetch: fakeFetch as any });
    expect(taskId).toBe('task-uuid-xyz');
    expect(fakeFetch).toHaveBeenCalled();
  });
});
