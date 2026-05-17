/**
 * harness-module-constants.test.js
 * 验证 src/harness.js 导出的 PIPELINE_STAGES 和 STATS_FIELDS 常量
 * 覆盖目标：src/harness.js 所有 44 行（新文件，diff-cover 要求 80%）
 */
import { describe, it, expect } from 'vitest';
import { PIPELINE_STAGES, STATS_FIELDS } from '../harness.js';

describe('PIPELINE_STAGES — 完整 10 步定义', () => {
  it('共有 10 个步骤', () => {
    expect(PIPELINE_STAGES).toHaveLength(10);
  });

  it('第一步是 Planner', () => {
    expect(PIPELINE_STAGES[0]).toEqual({ type: 'harness_planner', label: 'Planner' });
  });

  it('最后一步是 Cleanup', () => {
    const last = PIPELINE_STAGES[PIPELINE_STAGES.length - 1];
    expect(last.type).toBe('harness_cleanup');
    expect(last.label).toBe('Cleanup');
  });

  it('包含所有 10 个必要步骤 type', () => {
    const types = PIPELINE_STAGES.map(s => s.type);
    const required = [
      'harness_planner',
      'harness_contract_propose',
      'harness_contract_review',
      'harness_generate',
      'harness_evaluate',
      'harness_report',
      'harness_auto_merge',
      'harness_deploy',
      'harness_smoke_test',
      'harness_cleanup',
    ];
    for (const t of required) {
      expect(types).toContain(t);
    }
  });

  it('每个步骤都有非空 type 和 label 字段', () => {
    for (const stage of PIPELINE_STAGES) {
      expect(typeof stage.type).toBe('string');
      expect(stage.type.length).toBeGreaterThan(0);
      expect(typeof stage.label).toBe('string');
      expect(stage.label.length).toBeGreaterThan(0);
    }
  });

  it('步骤顺序：Evaluate 在 Generate 之后，Cleanup 在 Smoke-test 之后', () => {
    const types = PIPELINE_STAGES.map(s => s.type);
    const genIdx     = types.indexOf('harness_generate');
    const evalIdx    = types.indexOf('harness_evaluate');
    const smokeIdx   = types.indexOf('harness_smoke_test');
    const cleanupIdx = types.indexOf('harness_cleanup');

    expect(evalIdx).toBeGreaterThan(genIdx);
    expect(cleanupIdx).toBeGreaterThan(smokeIdx);
  });

  it('step labels 映射正确（Evaluate / Smoke-test / Cleanup）', () => {
    const byType = Object.fromEntries(PIPELINE_STAGES.map(s => [s.type, s.label]));
    expect(byType['harness_evaluate']).toBe('Evaluate');
    expect(byType['harness_smoke_test']).toBe('Smoke-test');
    expect(byType['harness_cleanup']).toBe('Cleanup');
    expect(byType['harness_auto_merge']).toBe('Auto-merge');
  });
});

describe('STATS_FIELDS — 统计字段类型定义', () => {
  it('包含 completion_rate 字段（number 类型）', () => {
    expect(STATS_FIELDS.completion_rate).toBe('number');
  });

  it('包含 avg_gan_rounds 字段（number 类型）', () => {
    expect(STATS_FIELDS.avg_gan_rounds).toBe('number');
  });

  it('包含 avg_duration 字段（number 类型）', () => {
    expect(STATS_FIELDS.avg_duration).toBe('number');
  });

  it('恰好有三个字段', () => {
    expect(Object.keys(STATS_FIELDS)).toHaveLength(3);
  });

  it('所有字段值均为 "number" 字符串', () => {
    for (const val of Object.values(STATS_FIELDS)) {
      expect(val).toBe('number');
    }
  });
});
