/**
 * HarnessPipelinePage LangGraph 模式渲染单元测试
 * 覆盖 formatLangGraphSummary 纯函数：LangGraph 模式下的摘要文案生成
 */

import { describe, it, expect } from 'vitest';
import { formatLangGraphSummary, formatDuration, formatRelativeTime } from '../HarnessPipelinePage';

describe('formatLangGraphSummary', () => {
  it('in_progress 任务展示「正在 + 节点名」', () => {
    const lg = {
      current_node: 'evaluator',
      current_node_label: 'Evaluator',
      last_verdict: 'FAIL',
      review_round: 2,
      eval_round: 3,
      gan_rounds: 2,
      fix_rounds: 3,
      total_steps: 11,
      pr_url: null,
      last_error: null,
      last_event_at: null,
    };
    const out = formatLangGraphSummary(lg, 'in_progress');
    expect(out).toContain('正在 Evaluator');
    expect(out).toContain('R3: FAIL');
    expect(out).toContain('GAN 2 轮');
    expect(out).toContain('Fix 3 轮');
  });

  it('completed 任务展示「已完成」', () => {
    const lg = {
      current_node: 'report',
      current_node_label: 'Report',
      last_verdict: 'PASS',
      review_round: 2,
      eval_round: 4,
      gan_rounds: 2,
      fix_rounds: 4,
      total_steps: 14,
      pr_url: null,
      last_error: null,
      last_event_at: null,
    };
    const out = formatLangGraphSummary(lg, 'completed');
    expect(out).toContain('已完成');
    expect(out).toContain('Report');
    expect(out).toContain('GAN 2 轮');
    expect(out).toContain('Fix 4 轮');
  });

  it('failed / cancelled 任务展示「已停在」', () => {
    const lg = {
      current_node: 'generator',
      current_node_label: 'Generator',
      last_verdict: null,
      review_round: 0,
      eval_round: 0,
      gan_rounds: 1,
      fix_rounds: 0,
      total_steps: 5,
      pr_url: null,
      last_error: 'git push failed',
      last_event_at: null,
    };
    expect(formatLangGraphSummary(lg, 'cancelled')).toContain('已停在 Generator');
    expect(formatLangGraphSummary(lg, 'failed')).toContain('已停在 Generator');
  });

  it('reviewer 节点使用 review_round 编号', () => {
    const lg = {
      current_node: 'reviewer',
      current_node_label: 'Reviewer',
      last_verdict: 'REVISION',
      review_round: 1,
      eval_round: 0,
      gan_rounds: 1,
      fix_rounds: 0,
      total_steps: 3,
      pr_url: null,
      last_error: null,
      last_event_at: null,
    };
    const out = formatLangGraphSummary(lg, 'in_progress');
    expect(out).toContain('R1: REVISION');
  });

  it('0 轮时不输出 GAN / Fix 轮数', () => {
    const lg = {
      current_node: 'planner',
      current_node_label: 'Planner',
      last_verdict: null,
      review_round: 0,
      eval_round: 0,
      gan_rounds: 0,
      fix_rounds: 0,
      total_steps: 1,
      pr_url: null,
      last_error: null,
      last_event_at: null,
    };
    const out = formatLangGraphSummary(lg, 'in_progress');
    expect(out).not.toContain('GAN');
    expect(out).not.toContain('Fix');
    expect(out).toContain('正在 Planner');
  });
});

describe('formatDuration（工具）', () => {
  it('null / 0 返回空串', () => {
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(0)).toBe('');
    expect(formatDuration(undefined)).toBe('');
  });

  it('秒级', () => {
    expect(formatDuration(5000)).toBe('5s');
  });

  it('分钟级（有余秒）', () => {
    expect(formatDuration(90_000)).toBe('1m30s');
  });

  it('小时级', () => {
    expect(formatDuration(3_600_000)).toBe('1h');
    expect(formatDuration(3_900_000)).toBe('1h5m');
  });
});

describe('formatRelativeTime（工具）', () => {
  it('刚刚', () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe('刚刚');
  });

  it('几分钟前', () => {
    const t = new Date(Date.now() - 3 * 60_000).toISOString();
    expect(formatRelativeTime(t)).toMatch(/\d+ 分钟前/);
  });

  it('几天前', () => {
    const t = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(formatRelativeTime(t)).toMatch(/\d+ 天前/);
  });
});
