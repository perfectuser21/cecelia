/**
 * Workstream 1 — Health Handler 核心模块 [BEHAVIOR]
 *
 * 合同测试：验证 packages/brain/src/health.js 导出的纯逻辑
 * - buildHealthPayload({ nowMs, startedAtMs, version }) 返回三字段 {status, uptime_seconds, version}
 * - readBrainVersion(pkgPath?) 读取 packages/brain/package.json 的 version，读错 fallback "unknown"
 *
 * Generator 实现完成后这里 21-of-21 绿（本文件 9 个 it）。
 * 当前 Red 证据：模块尚未创建 → ERR_MODULE_NOT_FOUND
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// @ts-ignore - 目标模块尚未创建，TDD Red 阶段故意保留 import 错误
import { buildHealthPayload, readBrainVersion } from '../../../packages/brain/src/health.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_JSON_PATH = join(__dirname, '..', '..', '..', 'packages', 'brain', 'package.json');
const PKG_VERSION = JSON.parse(readFileSync(PKG_JSON_PATH, 'utf8')).version as string;

describe('Workstream 1 — Health Handler [BEHAVIOR]', () => {
  it('buildHealthPayload 返回对象键集合严格等于 {status, uptime_seconds, version}', () => {
    const payload = buildHealthPayload({ nowMs: 10_000, startedAtMs: 0, version: 'test-version' });
    expect(Object.keys(payload).sort()).toEqual(['status', 'uptime_seconds', 'version']);
  });

  it('buildHealthPayload 返回的 status 恒等于字符串 "ok"', () => {
    const payload = buildHealthPayload({ nowMs: 10_000, startedAtMs: 0, version: 'test-version' });
    expect(payload.status).toBe('ok');
  });

  it('buildHealthPayload 以 Math.floor((now - startedAt)/1000) 计算 uptime_seconds', () => {
    // (5999 - 1000) / 1000 = 4.999，floor = 4
    const payload = buildHealthPayload({ nowMs: 5999, startedAtMs: 1000, version: 'x' });
    expect(payload.uptime_seconds).toBe(4);
  });

  it('buildHealthPayload 在 now < startedAt 时返回 uptime_seconds === 0', () => {
    const payload = buildHealthPayload({ nowMs: 500, startedAtMs: 1000, version: 'x' });
    expect(payload.uptime_seconds).toBe(0);
  });

  it('buildHealthPayload 在 now === startedAt 时返回 uptime_seconds === 0', () => {
    const payload = buildHealthPayload({ nowMs: 1000, startedAtMs: 1000, version: 'x' });
    expect(payload.uptime_seconds).toBe(0);
  });

  it('buildHealthPayload 在运行 3600500ms 后返回 uptime_seconds === 3600', () => {
    const payload = buildHealthPayload({ nowMs: 3_600_500, startedAtMs: 0, version: 'x' });
    expect(payload.uptime_seconds).toBe(3600);
  });

  it('readBrainVersion 读出 packages/brain/package.json 中的 version 值', () => {
    expect(readBrainVersion()).toBe(PKG_VERSION);
  });

  it('readBrainVersion 在 package.json 读取抛错时返回字符串 "unknown" 且不抛出', () => {
    expect(() => readBrainVersion('/definitely/nonexistent/path/package.json')).not.toThrow();
    expect(readBrainVersion('/definitely/nonexistent/path/package.json')).toBe('unknown');
  });

  it('buildHealthPayload 缺省 version 参数调用时 version === package.json 的 version', () => {
    const payload = buildHealthPayload({ nowMs: 10_000, startedAtMs: 0 });
    expect(payload.version).toBe(PKG_VERSION);
  });
});
