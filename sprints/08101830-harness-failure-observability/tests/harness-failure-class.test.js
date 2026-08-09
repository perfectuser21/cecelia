// TDD Red — harness 失败可观测：failure_class 枚举 SSOT 模块
// 被测模块尚未创建：packages/brain/src/harness-failure-class.js
// 本文件用 Vitest（describe/it/expect），与仓库其余测试同栈，禁 node:test。
//
// 禁 mock 边：本用例只测纯枚举/分类逻辑（无 DB 边），真 import 被测模块，不 stub。
// terminal 写入点 ↔ tasks.result 列的真 PG 落库验证由 contract-dod.md 的 [BEHAVIOR]
// （真 Brain 5221 + 真 psql）承担，不在本纯单测里 mock DB。
import { describe, it, expect } from 'vitest';
import {
  FAILURE_CLASSES,
  isValidFailureClass,
  classifyFailure,
  buildTerminalFailureResult,
} from '../../../packages/brain/src/harness-failure-class.js';

describe('harness-failure-class [BEHAVIOR]', () => {
  it('FAILURE_CLASSES is a non-empty frozen closed set including unknown', () => {
    expect(Array.isArray(FAILURE_CLASSES)).toBe(true);
    expect(FAILURE_CLASSES.length).toBeGreaterThan(0);
    expect(FAILURE_CLASSES).toContain('unknown');
    expect(Object.isFrozen(FAILURE_CLASSES)).toBe(true);
    // 闭集：无重复
    expect(new Set(FAILURE_CLASSES).size).toBe(FAILURE_CLASSES.length);
  });

  it('isValidFailureClass accepts enum members and rejects free text', () => {
    expect(isValidFailureClass('unknown')).toBe(true);
    expect(isValidFailureClass(FAILURE_CLASSES[0])).toBe(true);
    expect(isValidFailureClass('随便写的自由文本')).toBe(false);
    expect(isValidFailureClass('')).toBe(false);
    expect(isValidFailureClass(null)).toBe(false);
    expect(isValidFailureClass(undefined)).toBe(false);
  });

  it('classifyFailure maps a known reason to an enum member', () => {
    // 已知 raw reason 语料必须落到闭集成员（不得原样返回自由文本）
    const cls = classifyFailure('relay_deadline_exceeded');
    expect(isValidFailureClass(cls)).toBe(true);
    const cls2 = classifyFailure('pipeline_terminal_failure');
    expect(isValidFailureClass(cls2)).toBe(true);
  });

  it('classifyFailure falls back to unknown for unrecognized reason', () => {
    // 兜底：未识别原因 → unknown（保证 result.failure_class 永不为 null）
    expect(classifyFailure('some_never_seen_reason_xyz')).toBe('unknown');
    expect(classifyFailure(null)).toBe('unknown');
    expect(classifyFailure(undefined)).toBe('unknown');
    expect(classifyFailure('')).toBe('unknown');
  });

  it('buildTerminalFailureResult writes failure_class and failure_detail into result', () => {
    const r = buildTerminalFailureResult({
      failureClass: 'timeout',
      failureDetail: 'relay_deadline_exceeded after 3600s',
      existingResult: { pr_url: 'https://x' },
    });
    expect(r.failure_class).toBe('timeout');
    expect(typeof r.failure_detail).toBe('string');
    expect(r.failure_detail.length).toBeGreaterThan(0);
    // 保留既有 result 字段（合并而非覆盖）
    expect(r.pr_url).toBe('https://x');
  });

  it('buildTerminalFailureResult coerces an invalid class to unknown (never persists free text)', () => {
    const r = buildTerminalFailureResult({
      failureClass: '自由文本非法值',
      failureDetail: 'raw detail preserved here',
    });
    expect(r.failure_class).toBe('unknown');
    // 非法枚举值降级为 unknown，但原始描述进 failure_detail 不丢
    expect(r.failure_detail).toContain('raw detail');
  });
});
