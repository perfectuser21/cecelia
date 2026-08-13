/**
 * [BEHAVIOR] controllerSessionId 从创建端可信透传到 detached Kernel（RED-4）
 * sprint 08132021-controller-lease-renewal-r2 —— 现网 launchKernelProcess 只传
 *   [--task-id, --run-id]，run.js parseArgs 也不认 --controller-session-id，
 *   心跳只有 run_id、无从做可信续租（禁止仅凭 run_id 续租）。
 *
 * 纯参数装配 seam（无 DB、无进程 spawn），不碰被改的 DB 写边——writeHeartbeat 续租
 * CAS 的真 PG 执法在 kernel-controller-lease-renewal.pg.integration.test.js。
 *
 * TDD 红：buildKernelLaunchArgs 尚未导出（import 即失败）+ parseArgs 无
 * controllerSessionId 字段 → 断言 FAIL。
 *
 * 永久回归位（sprint frozen 版在 sprints/08132021-controller-lease-renewal-r2/tests/）。
 */
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../orchestrator/run.js';
import { buildKernelLaunchArgs } from '../harness-skill-relay.js';

describe('controllerSessionId 可信透传（RED-4）', () => {
  it('parseArgs 解析 --controller-session-id 作为 Kernel 续租身份', () => {
    const args = parseArgs([
      '--task-id', 't-1', '--run-id', 'r-1', '--controller-session-id', 'sess-abc',
    ]);
    expect(args.controllerSessionId).toBe('sess-abc');
  });

  it('buildKernelLaunchArgs 把创建时 controllerSessionId 透传给 detached child（不止 run_id）', () => {
    const argv = buildKernelLaunchArgs({
      runner: '/x/run.js', taskId: 't-1', runId: 'r-1', controllerSessionId: 'sess-abc',
    });
    const idx = argv.indexOf('--controller-session-id');
    expect(idx).toBeGreaterThan(-1);
    expect(argv[idx + 1]).toBe('sess-abc');
    expect(argv).toContain('--run-id'); // run_id 仍在，但续租身份必须随参数一并落地
  });

  it('buildKernelLaunchArgs 透传 resumeToken（存在时）且不注入伪 session', () => {
    const argv = buildKernelLaunchArgs({
      runner: '/x/run.js', taskId: 't-1', runId: 'r-1', controllerSessionId: 'sess-abc', resumeToken: 'rt-9',
    });
    const ri = argv.indexOf('--resume-token');
    expect(ri).toBeGreaterThan(-1);
    expect(argv[ri + 1]).toBe('rt-9');
  });
});
