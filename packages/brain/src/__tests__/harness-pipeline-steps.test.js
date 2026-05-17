/**
 * harness-pipeline-steps.test.js
 * 测试 harness.js 中 buildSteps 相关逻辑的单元测试
 */
import { describe, it, expect } from 'vitest';

// 因为 harness.js 中函数未导出，这里测试构建逻辑的核心规则

describe('Pipeline Steps — label generation', () => {
  function buildStepLabel(taskType, counters) {
    // 注：harness_planner 已退役（PR retire-harness-planner），已从 BASE_LABELS 移除
    const BASE_LABELS = {
      harness_contract_propose: 'Propose',
      harness_contract_review: 'Review',
      harness_generate: 'Generate',
      harness_fix: 'Fix',
      harness_ci_watch: 'CI Watch',
      harness_report: 'Report',
    };

    const base = BASE_LABELS[taskType] || taskType;
    const needsRound = taskType.includes('propose') || taskType.includes('review');
    if (!needsRound) return base;

    counters[taskType] = (counters[taskType] || 0) + 1;
    return `${base} R${counters[taskType]}`;
  }

  it('generates correct labels for single pipeline run', () => {
    const counters = {};
    expect(buildStepLabel('harness_contract_propose', counters)).toBe('Propose R1');
    expect(buildStepLabel('harness_contract_review', counters)).toBe('Review R1');
    expect(buildStepLabel('harness_generate', counters)).toBe('Generate');
    expect(buildStepLabel('harness_report', counters)).toBe('Report');
  });

  it('increments round numbers for multiple propose/review cycles', () => {
    const counters = {};
    expect(buildStepLabel('harness_contract_propose', counters)).toBe('Propose R1');
    expect(buildStepLabel('harness_contract_review', counters)).toBe('Review R1');
    expect(buildStepLabel('harness_contract_propose', counters)).toBe('Propose R2');
    expect(buildStepLabel('harness_contract_review', counters)).toBe('Review R2');
    expect(buildStepLabel('harness_contract_propose', counters)).toBe('Propose R3');
  });

  it('returns task_type as label for unknown types', () => {
    const counters = {};
    expect(buildStepLabel('unknown_type', counters)).toBe('unknown_type');
  });
});

describe('Pipeline Steps — rebuildPrompt', () => {
  function rebuildPrompt(task, sprintDir) {
    // 注：harness_planner 已退役（PR retire-harness-planner），分支已移除
    const t = task.task_type;
    const id = task.task_id;
    const desc = task.description || task.title || '';

    if (t === 'harness_contract_propose') {
      const round = task.payload?.propose_round || 1;
      return `/harness-contract-proposer\n\n## Harness v4.0 — Contract Proposer\n\ntask_id: ${id}\nsprint_dir: ${sprintDir}\npropose_round: ${round}\n\n${desc}`;
    }

    return desc;
  }

  it('builds proposer prompt with round number', () => {
    const task = {
      task_id: 'def-456', task_type: 'harness_contract_propose',
      description: 'propose desc', payload: { propose_round: 2 },
    };
    const result = rebuildPrompt(task, 'sprints');
    expect(result).toContain('/harness-contract-proposer');
    expect(result).toContain('propose_round: 2');
  });

  it('falls back to description for unknown types', () => {
    const task = { task_id: 'x', task_type: 'unknown', description: 'fallback' };
    expect(rebuildPrompt(task, 'sprints')).toBe('fallback');
  });
});
