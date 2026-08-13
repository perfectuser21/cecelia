/**
 * kernel-controller-lifecycle 纯函数单测（sprint 08131104）——
 * structuredFailureReason 脱敏/结构化 + isOwnerlessRun 无主判定（判定点 C = A OR B）。
 *
 * DB 写路径（handleKernelProcessFatal / reconcileOwnerlessKernelRuns）由真 PG 集成测试
 * src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js 覆盖（禁 mock 被改边）。
 * 本单测只覆盖不依赖 PG 的纯逻辑（确定性，注入 now，禁 Date.now）。
 */
import { describe, it, expect } from 'vitest';
import {
  structuredFailureReason,
  isOwnerlessRun,
  KERNEL_FATAL_REASON_PREFIX,
  OWNERLESS_RECOVERED_REASON_PREFIX,
} from '../kernel-controller-lifecycle.js';

describe('structuredFailureReason — 结构化 + 脱敏', () => {
  it('拼出 <prefix>:<code> 结构化码', () => {
    expect(structuredFailureReason(KERNEL_FATAL_REASON_PREFIX, 'dependency_assembly_failed'))
      .toBe('kernel_process_fatal:dependency_assembly_failed');
  });

  it('脱敏 Bearer / token / secret 明文（不落凭据）', () => {
    const reason = structuredFailureReason(KERNEL_FATAL_REASON_PREFIX, 'Bearer SUPERSECRET12345 token=SUPERSECRET12345');
    expect(reason.startsWith(`${KERNEL_FATAL_REASON_PREFIX}:`)).toBe(true);
    expect(reason).not.toContain('SUPERSECRET12345');
  });

  it('空白折叠为下划线且不含空格（单行结构化码）', () => {
    const reason = structuredFailureReason(OWNERLESS_RECOVERED_REASON_PREFIX, 'controller lease expired');
    expect(reason).toBe('ownerless_kernel_run_recovered:controller_lease_expired');
    expect(reason).not.toMatch(/\s/);
  });

  it('null/undefined code 归 unknown（不抛错）', () => {
    expect(structuredFailureReason(KERNEL_FATAL_REASON_PREFIX, null)).toBe('kernel_process_fatal:unknown');
    expect(structuredFailureReason(KERNEL_FATAL_REASON_PREFIX, undefined)).toBe('kernel_process_fatal:unknown');
  });
});

describe('isOwnerlessRun — 无主判定（C = A OR B）', () => {
  const now = new Date('2026-08-13T04:00:00.000Z');
  const future = new Date('2026-08-13T04:30:00.000Z').toISOString();
  const past = new Date('2026-08-13T03:30:00.000Z').toISOString();

  it('A：controller_session_id 为空 → 无主（含迁移前历史 run）', () => {
    expect(isOwnerlessRun({ phase: 'generate', controller_session_id: null, controller_lease_expires_at: future }, now)).toBe(true);
    expect(isOwnerlessRun({ phase: 'generate', controller_session_id: '  ', controller_lease_expires_at: future }, now)).toBe(true);
  });

  it('B：lease 过期或缺失 → 无主', () => {
    expect(isOwnerlessRun({ phase: 'evaluate', controller_session_id: 'c-1', controller_lease_expires_at: past }, now)).toBe(true);
    expect(isOwnerlessRun({ phase: 'evaluate', controller_session_id: 'c-1', controller_lease_expires_at: null }, now)).toBe(true);
  });

  it('健康 owned run（有 controller + lease 未过期）→ 非无主', () => {
    expect(isOwnerlessRun({ phase: 'generate', controller_session_id: 'c-1', controller_lease_expires_at: future }, now)).toBe(false);
  });

  it('terminal（done/failed）run 不再判无主', () => {
    expect(isOwnerlessRun({ phase: 'done', controller_session_id: null, controller_lease_expires_at: null }, now)).toBe(false);
    expect(isOwnerlessRun({ phase: 'failed', controller_session_id: null, controller_lease_expires_at: past }, now)).toBe(false);
  });

  it('接受 Date 或 ISO 字符串两种 lease 形态', () => {
    expect(isOwnerlessRun({ phase: 'generate', controller_session_id: 'c-1', controller_lease_expires_at: new Date(past) }, now)).toBe(true);
    expect(isOwnerlessRun({ phase: 'generate', controller_session_id: 'c-1', controller_lease_expires_at: new Date(future) }, now)).toBe(false);
  });
});
