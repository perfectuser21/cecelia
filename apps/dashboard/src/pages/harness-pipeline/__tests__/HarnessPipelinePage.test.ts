/**
 * HarnessPipelinePage 单元测试
 * 测试核心纯函数逻辑（不依赖 DOM/React）
 */

import { describe, it, expect } from 'vitest';

// ─── 从页面抽取的纯函数（重新实现，避免 React 依赖）────────────────────────────

type StepStatus = 'completed' | 'in_progress' | 'failed' | 'queued' | 'skipped';

function mapTaskStatus(status: string): StepStatus {
  switch (status) {
    case 'completed': return 'completed';
    case 'in_progress': return 'in_progress';
    case 'failed': return 'failed';
    case 'queued':
    case 'pending': return 'queued';
    default: return 'queued';
  }
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m${rem}s` : `${m}m`;
}

function calcDuration(task: { started_at: string | null; completed_at: string | null }): number | null {
  if (!task.started_at || !task.completed_at) return null;
  return new Date(task.completed_at).getTime() - new Date(task.started_at).getTime();
}

// ─── 测试 ─────────────────────────────────────────────────────────────────────

describe('mapTaskStatus', () => {
  it('应将 completed 映射为 completed', () => {
    expect(mapTaskStatus('completed')).toBe('completed');
  });

  it('应将 in_progress 映射为 in_progress', () => {
    expect(mapTaskStatus('in_progress')).toBe('in_progress');
  });

  it('应将 failed 映射为 failed', () => {
    expect(mapTaskStatus('failed')).toBe('failed');
  });

  it('应将 queued 和 pending 映射为 queued', () => {
    expect(mapTaskStatus('queued')).toBe('queued');
    expect(mapTaskStatus('pending')).toBe('queued');
  });

  it('未知状态默认映射为 queued', () => {
    expect(mapTaskStatus('unknown_status')).toBe('queued');
    expect(mapTaskStatus('')).toBe('queued');
  });
});

describe('formatDuration', () => {
  it('null 或 0 返回空字符串', () => {
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(0)).toBe('');
    expect(formatDuration(undefined)).toBe('');
  });

  it('小于 1s 显示 ms', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  it('秒级显示 Ns', () => {
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(59000)).toBe('59s');
  });

  it('分钟级显示 Nm', () => {
    expect(formatDuration(60000)).toBe('1m');
    expect(formatDuration(120000)).toBe('2m');
  });

  it('分钟+秒显示 NmNs', () => {
    expect(formatDuration(90000)).toBe('1m30s');
    expect(formatDuration(125000)).toBe('2m5s');
  });
});

describe('calcDuration', () => {
  it('缺少 started_at 返回 null', () => {
    expect(calcDuration({ started_at: null, completed_at: '2026-04-11T10:01:00Z' })).toBeNull();
  });

  it('缺少 completed_at 返回 null', () => {
    expect(calcDuration({ started_at: '2026-04-11T10:00:00Z', completed_at: null })).toBeNull();
  });

  it('计算正确的毫秒差', () => {
    const result = calcDuration({
      started_at: '2026-04-11T10:00:00Z',
      completed_at: '2026-04-11T10:01:30Z',
    });
    expect(result).toBe(90_000);
  });

  it('开始时间等于完成时间返回 0', () => {
    const ts = '2026-04-11T10:00:00Z';
    expect(calcDuration({ started_at: ts, completed_at: ts })).toBe(0);
  });
});

describe('Propose 状态聚合逻辑', () => {
  // 模拟 proposeStatus 聚合逻辑
  function aggregateProposeStatus(statuses: string[]): StepStatus {
    if (statuses.length === 0) return 'queued';
    if (statuses.some(s => s === 'in_progress')) return 'in_progress';
    if (statuses.some(s => s === 'failed')) return 'failed';
    if (statuses.every(s => s === 'completed')) return 'completed';
    return 'in_progress';
  }

  it('全部完成 → completed', () => {
    expect(aggregateProposeStatus(['completed', 'completed', 'completed'])).toBe('completed');
  });

  it('任一进行中 → in_progress', () => {
    expect(aggregateProposeStatus(['completed', 'in_progress'])).toBe('in_progress');
  });

  it('任一失败（无进行中）→ failed', () => {
    expect(aggregateProposeStatus(['completed', 'failed'])).toBe('failed');
  });

  it('空数组 → queued', () => {
    expect(aggregateProposeStatus([])).toBe('queued');
  });

  it('混合完成和待排队 → in_progress', () => {
    expect(aggregateProposeStatus(['completed', 'queued'])).toBe('in_progress');
  });
});
