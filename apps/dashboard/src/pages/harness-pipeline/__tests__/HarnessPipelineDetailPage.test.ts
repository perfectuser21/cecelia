/**
 * HarnessPipelineDetailPage 单元测试
 * 测试核心纯函数逻辑（GAN 轮次构建、阶段构建）
 */

import { describe, it, expect } from 'vitest';

// ─── 从后端 harness.js 抽取的纯函数（重新实现，避免 Node 依赖）────────────────

interface Task {
  task_id: string;
  task_type: string;
  status: string;
  title?: string;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error_message?: string | null;
  pr_url?: string | null;
}

interface GanRound {
  round: number;
  propose: {
    task_id: string;
    status: string;
    created_at: string;
    completed_at: string | null;
    verdict: string | null;
    propose_round: number;
  } | null;
  review: {
    task_id: string;
    status: string;
    created_at: string;
    completed_at: string | null;
    verdict: string | null;
    feedback: string | null;
    contract_branch: string | null;
  } | null;
}

function buildGanRounds(tasks: Task[]): GanRound[] {
  const proposes = tasks.filter(t =>
    t.task_type === 'harness_contract_propose' || t.task_type === 'sprint_contract_propose'
  );
  const reviews = tasks.filter(t =>
    t.task_type === 'harness_contract_review' || t.task_type === 'sprint_contract_review'
  );

  const rounds: GanRound[] = [];
  for (let i = 0; i < Math.max(proposes.length, reviews.length); i++) {
    const propose = proposes[i] || null;
    const review = reviews[i] || null;
    rounds.push({
      round: i + 1,
      propose: propose ? {
        task_id: propose.task_id,
        status: propose.status,
        created_at: propose.created_at,
        completed_at: propose.completed_at || null,
        verdict: (propose.result as Record<string, unknown>)?.verdict as string || null,
        propose_round: (propose.result as Record<string, unknown>)?.propose_round as number || i + 1,
      } : null,
      review: review ? {
        task_id: review.task_id,
        status: review.status,
        created_at: review.created_at,
        completed_at: review.completed_at || null,
        verdict: (review.result as Record<string, unknown>)?.verdict as string || null,
        feedback: (review.result as Record<string, unknown>)?.feedback as string || null,
        contract_branch: (review.result as Record<string, unknown>)?.contract_branch as string ||
                        (review.payload as Record<string, unknown>)?.contract_branch as string || null,
      } : null,
    });
  }
  return rounds;
}

const STAGE_ORDER = [
  'harness_planner', 'harness_contract_propose', 'harness_contract_review',
  'harness_generate', 'harness_ci_watch', 'harness_report',
];

function buildStages(tasks: Task[]) {
  return STAGE_ORDER.map(type => {
    const matching = tasks.filter(t => t.task_type === type);
    const latest = matching[matching.length - 1];
    return {
      task_type: type,
      status: latest?.status || 'not_started',
      task_id: latest?.task_id || null,
      count: matching.length,
    };
  });
}

// ─── 测试 ─────────────────────────────────────────────────────────────────────

describe('buildGanRounds', () => {
  it('无 propose/review 时返回空数组', () => {
    const tasks: Task[] = [
      { task_id: '1', task_type: 'harness_planner', status: 'completed', created_at: '2026-04-11T10:00:00Z' },
    ];
    expect(buildGanRounds(tasks)).toEqual([]);
  });

  it('3 轮 GAN 对抗正确配对', () => {
    const tasks: Task[] = [
      { task_id: 'p1', task_type: 'harness_contract_propose', status: 'completed', created_at: '2026-04-11T10:01:00Z', result: { verdict: 'PROPOSED', propose_round: 1 } },
      { task_id: 'r1', task_type: 'harness_contract_review', status: 'completed', created_at: '2026-04-11T10:02:00Z', result: { verdict: 'REVISION' } },
      { task_id: 'p2', task_type: 'harness_contract_propose', status: 'completed', created_at: '2026-04-11T10:03:00Z', result: { verdict: 'PROPOSED', propose_round: 2 } },
      { task_id: 'r2', task_type: 'harness_contract_review', status: 'completed', created_at: '2026-04-11T10:04:00Z', result: { verdict: 'REVISION' } },
      { task_id: 'p3', task_type: 'harness_contract_propose', status: 'completed', created_at: '2026-04-11T10:05:00Z', result: { verdict: 'PROPOSED', propose_round: 3 } },
      { task_id: 'r3', task_type: 'harness_contract_review', status: 'completed', created_at: '2026-04-11T10:06:00Z', result: { verdict: 'APPROVED', contract_branch: 'cp-approved' } },
    ];
    const rounds = buildGanRounds(tasks);
    expect(rounds).toHaveLength(3);
    expect(rounds[0].round).toBe(1);
    expect(rounds[0].propose?.verdict).toBe('PROPOSED');
    expect(rounds[0].review?.verdict).toBe('REVISION');
    expect(rounds[2].review?.verdict).toBe('APPROVED');
    expect(rounds[2].review?.contract_branch).toBe('cp-approved');
  });

  it('propose 多于 review 时不丢失', () => {
    const tasks: Task[] = [
      { task_id: 'p1', task_type: 'harness_contract_propose', status: 'completed', created_at: '2026-04-11T10:01:00Z' },
      { task_id: 'p2', task_type: 'harness_contract_propose', status: 'in_progress', created_at: '2026-04-11T10:03:00Z' },
      { task_id: 'r1', task_type: 'harness_contract_review', status: 'completed', created_at: '2026-04-11T10:02:00Z', result: { verdict: 'REVISION' } },
    ];
    const rounds = buildGanRounds(tasks);
    expect(rounds).toHaveLength(2);
    expect(rounds[1].propose?.task_id).toBe('p2');
    expect(rounds[1].review).toBeNull();
  });

  it('review feedback 正确提取', () => {
    const tasks: Task[] = [
      { task_id: 'p1', task_type: 'harness_contract_propose', status: 'completed', created_at: '2026-04-11T10:01:00Z' },
      { task_id: 'r1', task_type: 'harness_contract_review', status: 'completed', created_at: '2026-04-11T10:02:00Z', result: { verdict: 'REVISION', feedback: '需要增加测试覆盖率' } },
    ];
    const rounds = buildGanRounds(tasks);
    expect(rounds[0].review?.feedback).toBe('需要增加测试覆盖率');
  });
});

describe('buildStages', () => {
  it('无任务时全部 not_started', () => {
    const stages = buildStages([]);
    expect(stages).toHaveLength(6);
    expect(stages.every(s => s.status === 'not_started')).toBe(true);
  });

  it('正确反映最新任务状态', () => {
    const tasks: Task[] = [
      { task_id: '1', task_type: 'harness_planner', status: 'completed', created_at: '2026-04-11T10:00:00Z' },
      { task_id: '2', task_type: 'harness_contract_propose', status: 'completed', created_at: '2026-04-11T10:01:00Z' },
      { task_id: '3', task_type: 'harness_contract_review', status: 'in_progress', created_at: '2026-04-11T10:02:00Z' },
    ];
    const stages = buildStages(tasks);
    expect(stages[0].status).toBe('completed'); // planner
    expect(stages[1].status).toBe('completed'); // propose
    expect(stages[2].status).toBe('in_progress'); // review
    expect(stages[3].status).toBe('not_started'); // generate
  });

  it('同类型多个任务取最后一个', () => {
    const tasks: Task[] = [
      { task_id: 'p1', task_type: 'harness_contract_propose', status: 'completed', created_at: '2026-04-11T10:01:00Z' },
      { task_id: 'p2', task_type: 'harness_contract_propose', status: 'completed', created_at: '2026-04-11T10:03:00Z' },
      { task_id: 'p3', task_type: 'harness_contract_propose', status: 'failed', created_at: '2026-04-11T10:05:00Z' },
    ];
    const stages = buildStages(tasks);
    const proposeStage = stages.find(s => s.task_type === 'harness_contract_propose')!;
    expect(proposeStage.status).toBe('failed');
    expect(proposeStage.task_id).toBe('p3');
    expect(proposeStage.count).toBe(3);
  });
});

describe('formatDuration (detail page)', () => {
  function formatDuration(startStr: string | null, endStr: string | null): string {
    if (!startStr) return '';
    const start = new Date(startStr).getTime();
    const end = endStr ? new Date(endStr).getTime() : Date.now();
    const ms = end - start;
    if (ms <= 0) return '';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }

  it('null start 返回空', () => {
    expect(formatDuration(null, '2026-04-11T10:00:00Z')).toBe('');
  });

  it('正确计算 90 秒', () => {
    expect(formatDuration('2026-04-11T10:00:00Z', '2026-04-11T10:01:30Z')).toBe('1m 30s');
  });

  it('正确计算 5 秒', () => {
    expect(formatDuration('2026-04-11T10:00:00Z', '2026-04-11T10:00:05Z')).toBe('5s');
  });
});
