/**
 * executor-model-select.test.js
 *
 * 测试双 Provider 模型路由：
 * - D1-1: getModelForTask() 当 provider=anthropic 时 dev 返回 claude-sonnet-4-6
 * - D1-3: getModelForTask() 当 provider=anthropic 时 dev 映射为 claude-sonnet-4-6
 * - D1-5: getProviderForTask() 默认返回 anthropic
 * - D1-6: FIXED_PROVIDER 固定路由（codex_qa→openai）
 *
 * DoD 映射：
 * - D1-1 → 'anthropic dev 返回 claude-sonnet-4-6'
 * - D1-3 → 'anthropic dev 映射为 claude-sonnet-4-6'
 * - D1-5 → 'getProviderForTask 默认 anthropic'
 * - D1-6 → 'FIXED_PROVIDER 完整'
 */

import { describe, it, expect, vi } from 'vitest';

// Mock 所有 executor 依赖
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../trace.js', () => ({ traceStep: vi.fn(() => ({ start: vi.fn(), end: vi.fn() })), LAYER: {}, STATUS: {}, EXECUTOR_HOSTS: {} }));
vi.mock('../task-router.js', () => ({ getTaskLocation: vi.fn(() => 'us'), LOCATION_MAP: {} }));
vi.mock('../task-updater.js', () => ({ updateTask: vi.fn() }));
vi.mock('../learning.js', () => ({ recordLearning: vi.fn() }));

const { getModelForTask, getProviderForTask, MODELS, MODEL_MAP, FIXED_PROVIDER } = await import('../executor.js');

describe('D1: 双 Provider 模型路由', () => {
  // ============================================================
  // D1-1: anthropic provider + dev → claude-sonnet-4-6
  // ============================================================
  it('D1-1: dev 任务（默认 anthropic）返回 claude-sonnet-4-6', () => {
    const task = { id: 'task-1', task_type: 'dev', title: '编码任务' };
    expect(getProviderForTask(task)).toBe('anthropic');
    expect(getModelForTask(task)).toBe('claude-sonnet-4-6');
  });

  // ============================================================
  // D1-3: anthropic provider 下 dev 返回 claude-sonnet-4-6
  // ============================================================
  it('D1-3: MODEL_MAP 中 anthropic dev 映射为 claude-sonnet-4-6', () => {
    expect(MODEL_MAP.dev.anthropic).toBe('claude-sonnet-4-6');
  });

  // ============================================================
  // D1-5: getProviderForTask 默认返回 anthropic
  // ============================================================
  it('D1-5: dev 任务默认 provider=anthropic', () => {
    expect(getProviderForTask({ task_type: 'dev' })).toBe('anthropic');
  });

  it('D1-5: review 任务默认 provider=anthropic', () => {
    expect(getProviderForTask({ task_type: 'review' })).toBe('anthropic');
  });

  it('D1-5: qa 任务默认 provider=anthropic', () => {
    expect(getProviderForTask({ task_type: 'qa' })).toBe('anthropic');
  });

  it('D1-5: audit 任务默认 provider=anthropic', () => {
    expect(getProviderForTask({ task_type: 'audit' })).toBe('anthropic');
  });

  it('D1-5: undefined task_type 默认 provider=anthropic', () => {
    expect(getProviderForTask({ title: '未知类型' })).toBe('anthropic');
  });

  // ============================================================
  // D1-6: FIXED_PROVIDER 固定路由
  // ============================================================
  it('D1-6: exploratory 不在 FIXED_PROVIDER 中', () => {
    expect(FIXED_PROVIDER.exploratory).toBeUndefined();
  });

  it('D1-6: codex_qa 固定 openai', () => {
    expect(FIXED_PROVIDER.codex_qa).toBe('openai');
    expect(getProviderForTask({ task_type: 'codex_qa' })).toBe('openai');
  });

  it('D1-6: decomp_review 不在 FIXED_PROVIDER 中（走 default_provider）', () => {
    expect(FIXED_PROVIDER.decomp_review).toBeUndefined();
    expect(getProviderForTask({ task_type: 'decomp_review' })).toBe('anthropic');
  });

  it('D1-6: talk 不在 FIXED_PROVIDER 中（走 default_provider）', () => {
    expect(FIXED_PROVIDER.talk).toBeUndefined();
    expect(getProviderForTask({ task_type: 'talk' })).toBe('anthropic');
  });

  it('D1-6: research 不在 FIXED_PROVIDER 中（走 default_provider）', () => {
    expect(FIXED_PROVIDER.research).toBeUndefined();
    expect(getProviderForTask({ task_type: 'research' })).toBe('anthropic');
  });

  // ============================================================
  // 模型常量完整性
  // ============================================================
  it('MODELS 常量表完整', () => {
    expect(MODELS.OPUS).toBe('claude-opus-4-20250514');
    expect(MODELS.SONNET).toBe('claude-sonnet-4-20250514');
    expect(MODELS.HAIKU).toBe('claude-haiku-4-5-20251001');
    expect(MODELS.M25_HIGHSPEED).toBe('MiniMax-M2.5-highspeed');
    expect(MODELS.M21).toBe('MiniMax-M2.1');
    expect(MODELS.CODEX).toBe('codex');
  });

  // ============================================================
  // codex_qa 特殊处理
  // ============================================================
  it('codex_qa 任务 getModelForTask 返回 null', () => {
    const task = { task_type: 'codex_qa' };
    expect(getModelForTask(task)).toBeNull();
  });

  // ============================================================
  // 所有 MODEL_MAP 任务类型 anthropic 映射
  // ============================================================
  it('review 任务 anthropic 返回 claude-sonnet-4-6', () => {
    expect(getModelForTask({ task_type: 'review' })).toBe('claude-sonnet-4-6');
  });

  it('talk 任务返回 claude-haiku-4-5-20251001', () => {
    expect(getModelForTask({ task_type: 'talk' })).toBe('claude-haiku-4-5-20251001');
  });

  it('research 任务返回 claude-sonnet-4-6', () => {
    expect(getModelForTask({ task_type: 'research' })).toBe('claude-sonnet-4-6');
  });

  it('decomp_review 任务返回 claude-haiku-4-5-20251001', () => {
    expect(getModelForTask({ task_type: 'decomp_review' })).toBe('claude-haiku-4-5-20251001');
  });

  // 未知任务类型兜底（fallback: provider=anthropic, 无映射 → null）
  it('未知任务类型兜底返回 null', () => {
    expect(getModelForTask({ task_type: 'unknown_type' })).toBeNull();
  });
});
