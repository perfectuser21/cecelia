/**
 * FT-2: 断言闭环验证
 * Red 阶段 — 验证 pollAssert 超时时 drill_report 含 verdict=FAIL 且 exit 1
 *
 * 现版本 Bug-2：
 *   - runOomDrill assertFn 里有 `if (task.status === 'failed') return { pass: true }` — 错误判据
 *   - drill_report content 不含结构化 verdict/mode/assertions/elapsed_ms 字段
 *
 * 修复后（Green）：
 *   - 超时 → result.pass=false → archiveDrillResult content 含 verdict=FAIL
 *   - 主流程走 process.exit(1)
 */

import { describe, it, expect, vi } from 'vitest';
import { runOomDrill, archiveDrillResult, notifyDrillFailure } from '../../../../scripts/canary-death-drill.mjs';

describe('FT-2: 断言闭环验证', () => {
  it('pollAssert timeoutMin=0 → result.pass=false → archiveDrillResult content 含 verdict=FAIL', async () => {
    // fetchStub: task.status 保持 in_progress（watchdog 未处置），立即超时
    const fetchStub = vi.fn(async (url, opts) => {
      if (opts?.method === 'PATCH') {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      // GET task：status=in_progress，watchdog 尚未处置（无 oom_upgraded/phase 变化）
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'canary-test-001',
          status: 'in_progress',
          payload: { orchestrator: 'skill-relay', canary: 'true' },
          result: {},
        }),
      };
    });

    const archiveCalls = [];
    const archiveStub = vi.fn(async (opts) => {
      archiveCalls.push(opts);
    });

    // timeoutMin=0 立即超时
    const result = await runOomDrill({
      taskId: 'canary-test-001',
      fetchFn: fetchStub,
      baseUrl: 'http://localhost:5222',
      timeoutMin: 0,
    });

    // 断言1：超时后 result.pass === false
    // Red 阶段：现版本 assertFn 里 task.status='in_progress' 时 pass=false 确实
    // 但 assertFn 有 `if (task.status === 'failed') return { pass: true }` bug
    // timeoutMin=0 场景：循环不执行，直接返回 pass=false → 这部分当前可能已是 false
    expect(result.pass).toBe(false);

    // 断言2：验证 drill_report content 含结构化字段（修复后才有 verdict/assertions/elapsed_ms）
    // 此处测试 archiveDrillResult 写入的 content 是否含这些字段
    const archiveBody = {
      taskId: 'canary-test-001',
      mode: 'oom',
      results: result,
      success: result.pass,
      fetchFn: async (url, opts) => {
        archiveCalls.push(JSON.parse(opts?.body || '{}'));
        return { ok: true, status: 200, json: async () => ({}) };
      },
      baseUrl: 'http://localhost:5222',
    };

    await archiveDrillResult(archiveBody);

    // 验证落档内容包含必要字段（Red 阶段：现版本 content 为旧格式，不含 verdict/assertions/elapsed_ms）
    const archived = archiveCalls[archiveCalls.length - 1];
    const content = typeof archived?.content === 'string'
      ? JSON.parse(archived.content)
      : archived?.content;

    // 修复后才有的字段——Red 阶段这些断言会失败（因为现版本不写这些字段）
    expect(archived?.type).toBe('drill_report');
    expect(content).toHaveProperty('verdict');
    expect(content.verdict).toBe('FAIL');
    expect(content).toHaveProperty('mode');
    expect(content).toHaveProperty('assertions');
    expect(Array.isArray(content.assertions)).toBe(true);
    expect(content).toHaveProperty('elapsed_ms');
    expect(typeof content.elapsed_ms).toBe('number');
  });

  it('notifyDrillFailure barkFn=null 时只 warn 不抛出（BARK_URL 未设场景）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await notifyDrillFailure({
      taskId: 'canary-test-001',
      mode: 'oom',
      failedAssertions: ['超时 0min'],
      barkFn: null,
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('CanaryDrill Failed'));
    warnSpy.mockRestore();
  });
});
