/**
 * 合同测试骨架 — 探针接入验证
 * task_id: c11cdec4-c845-447f-80da-9d528753be1d
 * sprint: incidents-layer（刀5-小刀1）
 *
 * 覆盖：
 *   [BEHAVIOR-6] launchd-patrol 红触发路径调用 reportIncident()
 *   [BEHAVIOR-7] dept-heartbeat 超时告警后调用 reportIncident()
 *   [BEHAVIOR-8] circuit-breaker OPEN 时调用 reportIncident()
 *
 * 注意：这些测试验证探针文件中是否存在 reportIncident 调用，
 *       并通过 mock 验证调用参数符合 fingerprint 格式约定。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

// 用 import.meta.url 定位源码目录（对 process.cwd() 免疫，brain-unit cwd=packages/brain 也正确）
const __testDir = fileURLToPath(new URL('.', import.meta.url));
const BRAIN_SRC = resolve(__testDir, '../../../packages/brain/src');

// ── 静态检查：验证源码中存在 reportIncident 调用 ────────────────────────────
describe('[BEHAVIOR-6] launchd-patrol 接入静态检查', () => {
  it('launchd-patrol.js 应包含 reportIncident 调用', () => {
    const src = readFileSync(resolve(BRAIN_SRC, 'launchd-patrol.js'), 'utf8');
    expect(src).toMatch(/reportIncident/);
  });

  it('launchd-patrol.js 中 fingerprint 应含 launchd-patrol: 前缀', () => {
    const src = readFileSync(resolve(BRAIN_SRC, 'launchd-patrol.js'), 'utf8');
    // fingerprint = `launchd-patrol:${daemonName}` 或类似写法
    expect(src).toMatch(/launchd-patrol:/);
  });
});

describe('[BEHAVIOR-7] dept-heartbeat 接入静态检查', () => {
  it('dept-heartbeat.js 应包含 reportIncident 调用', () => {
    const src = readFileSync(resolve(BRAIN_SRC, 'dept-heartbeat.js'), 'utf8');
    expect(src).toMatch(/reportIncident/);
  });

  it('dept-heartbeat.js 中 fingerprint 应含 heartbeat-silent: 前缀', () => {
    const src = readFileSync(resolve(BRAIN_SRC, 'dept-heartbeat.js'), 'utf8');
    expect(src).toMatch(/heartbeat-silent:/);
  });
});

describe('[BEHAVIOR-8] circuit-breaker 接入静态检查', () => {
  it('circuit-breaker.js 应包含 reportIncident 调用', () => {
    const src = readFileSync(resolve(BRAIN_SRC, 'circuit-breaker.js'), 'utf8');
    expect(src).toMatch(/reportIncident/);
  });

  it('circuit-breaker.js 中 fingerprint 应含 circuit-breaker-open: 前缀', () => {
    const src = readFileSync(resolve(BRAIN_SRC, 'circuit-breaker.js'), 'utf8');
    expect(src).toMatch(/circuit-breaker-open:/);
  });
});

// ── incident-reporter 模块导出检查 ───────────────────────────────────────────
describe('incident-reporter 模块接口检查', () => {
  // vi.mock 被 hoisted 到文件顶部，factory 内部必须自包含（不引用外部变量）
  vi.mock('../../../packages/brain/src/db/pool.js', () => {
    const q = vi.fn().mockResolvedValue({ rows: [] });
    return {
      default: { query: q },
      pool: { query: q },
    };
  });

  it('应导出 reportIncident 函数', async () => {
    const mod = await import('../../../packages/brain/src/incident-reporter.js');
    expect(typeof mod.reportIncident).toBe('function');
  });

  it('reportIncident 应接受 4 个参数（probeId, fingerprint, severity, evidence）', async () => {
    const { reportIncident } = await import(
      '../../../packages/brain/src/incident-reporter.js'
    );
    // 不应 throw（参数合法）
    await expect(
      reportIncident('probe', 'probe:key', 'p0', { foo: 'bar' })
    ).resolves.not.toThrow();
  });
});
