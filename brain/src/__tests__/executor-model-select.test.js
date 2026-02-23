/**
 * executor-model-select.test.js
 *
 * 测试双 Provider 模型路由：
 * - D1-1: getModelForTask() 当 provider=minimax 时 dev 返回 M2.5-highspeed
 * - D1-3: getModelForTask() 当 provider=anthropic 时 dev 返回 null (默认 Sonnet)
 * - D1-5: getProviderForTask() 默认返回 minimax
 * - D1-6: FIXED_PROVIDER 固定路由（codex_qa→openai, decomp_review→minimax 等）
 *
 * DoD 映射：
 * - D1-1 → 'minimax dev 返回 M2.5-highspeed'
 * - D1-3 → 'anthropic dev 返回 null'
 * - D1-5 → 'getProviderForTask 默认 minimax'
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
  // D1-1: minimax provider + dev → M2.5-highspeed
  // ============================================================
  it('D1-1: dev 任务（默认 minimax）返回 M2.5-highspeed', () => {
    const task = { id: 'task-1', task_type: 'dev', title: '编码任务' };
    expect(getProviderForTask(task)).toBe('minimax');
    expect(getModelForTask(task)).toBe('MiniMax-M2.5-highspeed');
  });

  // ============================================================
  // D1-3: anthropic provider 下 dev 返回 null（默认 Sonnet）
  // ============================================================
  it('D1-3: MODEL_MAP 中 anthropic dev 映射为 null', () => {
    expect(MODEL_MAP.dev.anthropic).toBeNull();
  });

  // ============================================================
  // D1-5: getProviderForTask 默认返回 minimax
  // ============================================================
  it('D1-5: dev 任务默认 provider=minimax', () => {
    expect(getProviderForTask({ task_type: 'dev' })).toBe('minimax');
  });

  it('D1-5: review 任务默认 provider=minimax', () => {
    expect(getProviderForTask({ task_type: 'review' })).toBe('minimax');
  });

  it('D1-5: qa 任务默认 provider=minimax', () => {
    expect(getProviderForTask({ task_type: 'qa' })).toBe('minimax');
  });

  it('D1-5: audit 任务默认 provider=minimax', () => {
    expect(getProviderForTask({ task_type: 'audit' })).toBe('minimax');
  });

  it('D1-5: undefined task_type 默认 provider=minimax', () => {
    expect(getProviderForTask({ title: '未知类型' })).toBe('minimax');
  });

  // ============================================================
  // D1-6: FIXED_PROVIDER 固定路由
  // ============================================================
  it('D1-6: codex_qa 固定 openai', () => {
    expect(FIXED_PROVIDER.codex_qa).toBe('openai');
    expect(getProviderForTask({ task_type: 'codex_qa' })).toBe('openai');
  });

  it('D1-6: decomp_review 固定 minimax', () => {
    expect(FIXED_PROVIDER.decomp_review).toBe('minimax');
  });

  it('D1-6: talk 固定 minimax', () => {
    expect(FIXED_PROVIDER.talk).toBe('minimax');
  });

  it('D1-6: research 固定 minimax', () => {
    expect(FIXED_PROVIDER.research).toBe('minimax');
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
  // 所有 MODEL_MAP 任务类型 minimax 映射
  // ============================================================
  it('review 任务 minimax 返回 M2.5-highspeed', () => {
    expect(getModelForTask({ task_type: 'review' })).toBe('MiniMax-M2.5-highspeed');
  });

  it('talk 任务返回 M2.5-highspeed', () => {
    expect(getModelForTask({ task_type: 'talk' })).toBe('MiniMax-M2.5-highspeed');
  });

  it('research 任务返回 M2.5-highspeed', () => {
    expect(getModelForTask({ task_type: 'research' })).toBe('MiniMax-M2.5-highspeed');
  });

  it('decomp_review 任务返回 M2.5-highspeed', () => {
    expect(getModelForTask({ task_type: 'decomp_review' })).toBe('MiniMax-M2.5-highspeed');
  });

  // 未知任务类型兜底
  it('未知任务类型兜底返回 M2.5-highspeed', () => {
    expect(getModelForTask({ task_type: 'unknown_type' })).toBe('MiniMax-M2.5-highspeed');
  });
});
