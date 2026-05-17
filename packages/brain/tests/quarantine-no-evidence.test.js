/**
 * DoD tests for resource_hog evidence gate
 *
 * [BEHAVIOR] 无内存/runtime 证据 → 不进 quarantine（classifyFailure 返回 UNKNOWN）
 * [BEHAVIOR] runtime 超 tier.timeout 1.2x → 进 quarantine reason=resource_hog
 * [ARTIFACT]  calcEvictionScore RSS < 100MB 不计驱逐内存分
 */
import { describe, it, expect } from 'vitest';
import { classifyFailure, FAILURE_CLASS } from '../src/quarantine.js';
import { calcEvictionScore, TIER_WEIGHTS } from '../src/eviction.js';
import { RESOURCE_TIERS } from '../src/spawn/middleware/resource-tier.js';

// ─── classifyFailure evidence gate ───────────────────────────────────────────

describe('classifyFailure evidence gate', () => {
  it('无 evidence → 走原有 error 字符串匹配路径（不受阈值约束）', () => {
    const result = classifyFailure('ECONNREFUSED');
    expect(result.class).toBe(FAILURE_CLASS.NETWORK);
  });

  it('evidence=null → 同上，不触发 evidence 分支', () => {
    const result = classifyFailure('some random error', null, null);
    expect(result.class).toBe(FAILURE_CLASS.TASK_ERROR);
  });

  it('evidence 无 rss_mb/runtime（全 0）→ UNKNOWN，不进 quarantine', () => {
    const result = classifyFailure('liveness_dead', { task_type: 'dev' }, { rss_mb: 0, runtime_ms: 0 });
    expect(result.class).toBe(FAILURE_CLASS.UNKNOWN);
  });

  it('evidence rss_mb=50（< 500）→ UNKNOWN', () => {
    const result = classifyFailure('kill', null, { rss_mb: 50, runtime_ms: 0 });
    expect(result.class).toBe(FAILURE_CLASS.UNKNOWN);
  });

  it('evidence rss_mb=499（< 500）→ UNKNOWN（边界）', () => {
    const result = classifyFailure('kill', null, { rss_mb: 499, runtime_ms: 0 });
    expect(result.class).toBe(FAILURE_CLASS.UNKNOWN);
  });

  it('evidence rss_mb=501（> 500）→ RESOURCE（resource_hog）', () => {
    const result = classifyFailure('kill', null, { rss_mb: 501, runtime_ms: 0 });
    expect(result.class).toBe(FAILURE_CLASS.RESOURCE);
  });

  it('evidence rss_mb=600 → RESOURCE', () => {
    const result = classifyFailure('watchdog_kill', { task_type: 'dev' }, { rss_mb: 600, runtime_ms: 0 });
    expect(result.class).toBe(FAILURE_CLASS.RESOURCE);
  });

  it('runtime 超 normal tier (90min) * 1.2 = 108min → RESOURCE', () => {
    const normalTimeoutMs = RESOURCE_TIERS.normal.timeoutMs; // 90min
    const runtimeMs = normalTimeoutMs * 1.25; // 112.5min，超阈值
    const result = classifyFailure('timeout', { task_type: 'normal' }, { rss_mb: 0, runtime_ms: runtimeMs });
    expect(result.class).toBe(FAILURE_CLASS.RESOURCE);
  });

  it('runtime 恰好等于 normal tier * 1.2（边界）→ UNKNOWN（不超阈值不隔离）', () => {
    const normalTimeoutMs = RESOURCE_TIERS.normal.timeoutMs;
    const runtimeMs = normalTimeoutMs * 1.2; // 精确等于阈值，不超过
    const result = classifyFailure('timeout', { task_type: 'normal' }, { rss_mb: 0, runtime_ms: runtimeMs });
    expect(result.class).toBe(FAILURE_CLASS.UNKNOWN);
  });

  it('runtime 超 heavy tier (120min) * 1.2 = 144min → RESOURCE', () => {
    const heavyTimeoutMs = RESOURCE_TIERS.heavy.timeoutMs; // 120min
    const runtimeMs = heavyTimeoutMs * 1.3;
    const result = classifyFailure('timeout', { task_type: 'dev' }, { rss_mb: 0, runtime_ms: runtimeMs });
    expect(result.class).toBe(FAILURE_CLASS.RESOURCE);
  });

  it('evidence liveness_dead（无 rss）→ UNKNOWN，对应主要 bug 场景', () => {
    // liveness_dead kill 传入的 evidence = errorDetails（无 rss_mb）
    const evidence = {
      rss_mb: undefined,
      runtime_ms: undefined,
    };
    const result = classifyFailure('liveness_dead', { task_type: 'dev' }, evidence);
    expect(result.class).toBe(FAILURE_CLASS.UNKNOWN);
  });

  it('RESOURCE 结果包含 confidence 和 retry_strategy', () => {
    const result = classifyFailure('kill', null, { rss_mb: 600, runtime_ms: 0 });
    expect(result.class).toBe(FAILURE_CLASS.RESOURCE);
    expect(result.confidence).toBe(0.9);
    expect(result.retry_strategy).toBeDefined();
  });

  it('UNKNOWN 结果 confidence 低于 RESOURCE', () => {
    const result = classifyFailure('kill', null, { rss_mb: 0, runtime_ms: 0 });
    expect(result.class).toBe(FAILURE_CLASS.UNKNOWN);
    expect(result.confidence).toBeLessThan(0.9);
  });
});

// ─── calcEvictionScore RSS 内存阈值保护 ──────────────────────────────────────

describe('calcEvictionScore RSS < 100MB 不计驱逐内存分', () => {
  it('RSS = 0MB → 内存贡献为 0', () => {
    const score0 = calcEvictionScore('P3', 0, 0);
    const score99 = calcEvictionScore('P3', 99, 0);
    // rss=0 和 rss=99 都 < 100，memPct=0，得分相同
    expect(score0).toBe(score99);
  });

  it('RSS = 50MB（< 100）→ 不计入内存分，与 rss=0 得分相同', () => {
    const score50 = calcEvictionScore('P3', 50, 0);
    const score0 = calcEvictionScore('P3', 0, 0);
    expect(score50).toBe(score0);
  });

  it('RSS = 99MB（< 100，严格边界）→ 不计内存分', () => {
    const score99 = calcEvictionScore('P3', 99, 0);
    const score0 = calcEvictionScore('P3', 0, 0);
    expect(score99).toBe(score0);
  });

  it('RSS = 100MB（等于阈值，NOT < 100）→ 计入内存分，得分 > rss=0', () => {
    const score100 = calcEvictionScore('P3', 100, 0);
    const score0 = calcEvictionScore('P3', 0, 0);
    expect(score100).toBeGreaterThan(score0);
  });

  it('RSS = 101MB（> 100）→ 计入内存分，得分高于 rss=0', () => {
    const score101 = calcEvictionScore('P3', 101, 0);
    const score0 = calcEvictionScore('P3', 0, 0);
    expect(score101).toBeGreaterThan(score0);
  });

  it('RSS = 500MB → 内存分显著提升', () => {
    const score500 = calcEvictionScore('P3', 500, 0);
    const score0 = calcEvictionScore('P3', 0, 0);
    expect(score500).toBeGreaterThan(score0);
  });

  it('P0/P1 永不驱逐（-Infinity），不受 RSS 影响', () => {
    expect(calcEvictionScore('P0', 999, 0)).toBe(-Infinity);
    expect(calcEvictionScore('P1', 999, 0)).toBe(-Infinity);
  });

  it('P2 RSS < 100 → 得分低于 P3 RSS < 100（tier 权重差异保留）', () => {
    const p2Score = calcEvictionScore('P2', 50, 0);
    const p3Score = calcEvictionScore('P3', 50, 0);
    expect(p3Score).toBeGreaterThan(p2Score);
  });
});
