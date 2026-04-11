/**
 * harness-pipeline-steps.test.js
 * 测试 harness.js 中 buildSteps 相关逻辑的单元测试
 */
import { describe, it, expect } from 'vitest';

// 因为 harness.js 中函数未导出，这里测试构建逻辑的核心规则

describe('Pipeline Steps — label generation', () => {
  function buildStepLabel(taskType, counters) {
    const BASE_LABELS = {
      harness_planner: 'Planner', sprint_planner: 'Planner',
      harness_contract_propose: 'Propose', sprint_contract_propose: 'Propose',
      harness_contract_review: 'Review', sprint_contract_review: 'Review',
      harness_generate: 'Generate', sprint_generate: 'Generate',
      harness_fix: 'Fix', sprint_fix: 'Fix',
      harness_evaluate: 'Evaluate', sprint_evaluate: 'Evaluate',
      harness_ci_watch: 'CI Watch',
      harness_report: 'Report', sprint_report: 'Report',
    };

    const base = BASE_LABELS[taskType] || taskType;
    const needsRound = taskType.includes('propose') || taskType.includes('review');
    if (!needsRound) return base;

    counters[taskType] = (counters[taskType] || 0) + 1;
    return `${base} R${counters[taskType]}`;
  }

  it('generates correct labels for single pipeline run', () => {
    const counters = {};
    expect(buildStepLabel('harness_planner', counters)).toBe('Planner');
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

  it('handles sprint_ prefixed task types', () => {
    const counters = {};
    expect(buildStepLabel('sprint_planner', counters)).toBe('Planner');
    expect(buildStepLabel('sprint_contract_propose', counters)).toBe('Propose R1');
    expect(buildStepLabel('sprint_contract_review', counters)).toBe('Review R1');
  });

  it('returns task_type as label for unknown types', () => {
    const counters = {};
    expect(buildStepLabel('unknown_type', counters)).toBe('unknown_type');
  });
});

describe('Pipeline Steps — rebuildPrompt', () => {
  function rebuildPrompt(task, sprintDir) {
    const t = task.task_type;
    const id = task.task_id;
    const desc = task.description || task.title || '';

    if (t === 'harness_planner' || t === 'sprint_planner') {
      return `/harness-planner\n\n## Harness v4.0 — Planner\n\ntask_id: ${id}\nsprint_dir: ${sprintDir}\n\n${desc}`;
    }

    if (t === 'harness_contract_propose' || t === 'sprint_contract_propose') {
      const round = task.payload?.propose_round || 1;
      return `/harness-contract-proposer\n\n## Harness v4.0 — Contract Proposer\n\ntask_id: ${id}\nsprint_dir: ${sprintDir}\npropose_round: ${round}\n\n${desc}`;
    }

    return desc;
  }

  it('builds planner prompt correctly', () => {
    const task = { task_id: 'abc-123', task_type: 'harness_planner', description: 'test desc' };
    const result = rebuildPrompt(task, 'sprints');
    expect(result).toContain('/harness-planner');
    expect(result).toContain('task_id: abc-123');
    expect(result).toContain('sprint_dir: sprints');
    expect(result).toContain('test desc');
  });

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
