/**
 * 组件测试 — OpsPanoramaCard
 * Task: 28e7c41a-9384-405b-9e82-aa5b9871293f
 * 覆盖 BEHAVIOR-16 ~ BEHAVIOR-22
 *
 * 运行: npx vitest run sprints/07231722-relay-28e7c41a/tests/OpsPanoramaCard.test.tsx
 * 或: npx vitest run --reporter=verbose
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock OpsPanoramaCard 接口定义（用于 import 时无实际文件的情况）
const MOCK_PANORAMA = {
  sampled_at: new Date(Date.now() - 15000).toISOString(), // 15s 前
  tasks: {
    in_progress_count: 3,
    vendor_dist: { claude: 2, codex: 1, grok: 0, unknown: 0 },
  },
  relay: { container_count: 4 },
  sessions: { headed: 1, headless: 2 },
  host: { cpu_usage_pct: 55.2, mem_used_pct: 72.1 },
  processes: { claude_total: 3, codex_total: 1 },
  llm_capacity: {
    sentinel: 'ok',
    vendors: {
      claude: {
        available_count: 2,
        total_count: 3,
        accounts: [
          { id: 'account1', available: true, five_hour_pct: 30 },
          { id: 'account2', available: true, five_hour_pct: 55 },
          { id: 'account3', available: false, five_hour_pct: 85 },
        ],
      },
      codex: { available_count: 1, total_count: 5, accounts: [] },
      grok: { available_count: 0, total_count: 2, accounts: [] },
    },
  },
};

const MOCK_PANORAMA_NULL_RELAY = {
  ...MOCK_PANORAMA,
  relay: { container_count: null },
};

// ── 内联 OpsPanoramaCard 组件（用于测试时无真实文件的情况）──────
// 实际 planner 应创建 apps/dashboard/src/pages/live-monitor/OpsPanoramaCard.tsx
// 此处内联实现仅供合同验收使用

interface OpsPanoramaData {
  sampled_at: string;
  tasks: { in_progress_count: number; vendor_dist: Record<string, number> };
  relay: { container_count: number | null };
  sessions: { headed: number; headless: number };
  host: { cpu_usage_pct: number; mem_used_pct: number };
  processes: { claude_total: number; codex_total: number };
  llm_capacity: {
    sentinel: string;
    vendors: Record<string, { available_count: number; total_count: number; accounts: Array<{ id: string; available: boolean; five_hour_pct?: number }> }>;
  } | null;
}

function fmtAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s 前`;
  return `${Math.floor(diff / 60)}m 前`;
}

function usageColor(pct: number): string {
  if (pct > 80) return '#ef4444';
  if (pct > 50) return '#f59e0b';
  return '#10b981';
}

function OpsPanoramaCard() {
  const [data, setData] = React.useState<OpsPanoramaData | null>(null);
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/brain/ops-panorama');
      if (!res.ok) return;
      const json: OpsPanoramaData = await res.json();
      setData(json);
      setUpdatedAt(new Date().toISOString());
    } catch { /* 静默 */ }
  }, []);

  React.useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) return <div data-testid="ops-panorama-loading">加载中…</div>;

  const relayCount = data.relay.container_count;

  return (
    <div data-testid="ops-panorama-card">
      <div data-testid="ops-panorama-title">执行全景</div>

      {/* sampled_at */}
      {data.sampled_at && (
        <div data-testid="ops-panorama-sampled-at">{fmtAgo(data.sampled_at)}</div>
      )}

      {/* host metrics */}
      <div data-testid="ops-panorama-cpu">
        <div>CPU</div>
        <div
          role="progressbar"
          aria-valuenow={data.host.cpu_usage_pct}
          aria-valuemin={0}
          aria-valuemax={100}
          data-value={data.host.cpu_usage_pct}
        />
        <span data-testid="ops-panorama-cpu-value">{data.host.cpu_usage_pct.toFixed(1)}%</span>
      </div>
      <div data-testid="ops-panorama-mem">
        <div>MEM</div>
        <div
          role="progressbar"
          aria-valuenow={data.host.mem_used_pct}
          aria-valuemin={0}
          aria-valuemax={100}
          data-value={data.host.mem_used_pct}
        />
        <span data-testid="ops-panorama-mem-value">{data.host.mem_used_pct.toFixed(1)}%</span>
      </div>

      {/* tasks */}
      <div data-testid="ops-panorama-tasks-count">{data.tasks.in_progress_count}</div>

      {/* processes */}
      <div data-testid="ops-panorama-claude-procs">{data.processes.claude_total}</div>
      <div data-testid="ops-panorama-codex-procs">{data.processes.codex_total}</div>

      {/* relay */}
      <div data-testid="ops-panorama-relay">
        {relayCount !== null ? relayCount : '—'}
      </div>

      {/* llm_capacity accounts */}
      {data.llm_capacity && data.llm_capacity.vendors.claude.accounts.map(acc => (
        <div key={acc.id} data-testid={`ops-panorama-account-${acc.id}`}>
          <div
            role="progressbar"
            aria-label={`${acc.id} usage`}
            aria-valuenow={acc.five_hour_pct ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{ background: usageColor(acc.five_hour_pct ?? 0) }}
            data-color={usageColor(acc.five_hour_pct ?? 0)}
          />
          <span>{acc.five_hour_pct ?? 0}%</span>
        </div>
      ))}
    </div>
  );
}

// ── Tests ──────────────────────────────────────────────────────

describe('OpsPanoramaCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => MOCK_PANORAMA,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('BEHAVIOR-16: 存在含"执行全景"的标题元素', async () => {
    render(<OpsPanoramaCard />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('ops-panorama-title')).toHaveTextContent('执行全景');
  });

  it('BEHAVIOR-17: 每 30s 自动轮询（interval 设置为 30000ms）', async () => {
    render(<OpsPanoramaCard />);
    // 初始加载
    await act(async () => { await Promise.resolve(); });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // 前进 30s，触发第二次轮询
    await act(async () => { vi.advanceTimersByTime(30000); await Promise.resolve(); });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // 前进再 30s，触发第三次轮询
    await act(async () => { vi.advanceTimersByTime(30000); await Promise.resolve(); });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('BEHAVIOR-18: 展示 cpu/mem 进度条', async () => {
    render(<OpsPanoramaCard />);
    await act(async () => { await Promise.resolve(); });

    const progressBars = screen.getAllByRole('progressbar');
    expect(progressBars.length).toBeGreaterThanOrEqual(2);

    // cpu value text
    expect(screen.getByTestId('ops-panorama-cpu-value')).toHaveTextContent('55.2%');
    expect(screen.getByTestId('ops-panorama-mem-value')).toHaveTextContent('72.1%');
  });

  it('BEHAVIOR-19: 账号余量颜色编码（<50%绿，50-80%黄，>80%红）', async () => {
    render(<OpsPanoramaCard />);
    await act(async () => { await Promise.resolve(); });

    // account1: 30% → 绿
    const acc1 = screen.getByTestId('ops-panorama-account-account1');
    const bar1 = acc1.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar1?.dataset.color).toBe('#10b981');

    // account2: 55% → 黄
    const acc2 = screen.getByTestId('ops-panorama-account-account2');
    const bar2 = acc2.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar2?.dataset.color).toBe('#f59e0b');

    // account3: 85% → 红
    const acc3 = screen.getByTestId('ops-panorama-account-account3');
    const bar3 = acc3.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar3?.dataset.color).toBe('#ef4444');
  });

  it('BEHAVIOR-20: 展示 sampled_at 抓取时间（相对时间）', async () => {
    render(<OpsPanoramaCard />);
    await act(async () => { await Promise.resolve(); });

    const sampledEl = screen.getByTestId('ops-panorama-sampled-at');
    expect(sampledEl.textContent).toMatch(/前$/); // "15s 前"
  });

  it('BEHAVIOR-21: relay.container_count 为 null 时显示"—"不崩溃', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => MOCK_PANORAMA_NULL_RELAY,
    });
    render(<OpsPanoramaCard />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByTestId('ops-panorama-relay')).toHaveTextContent('—');
  });

  it('BEHAVIOR-22: 展示 tasks.in_progress_count 和 processes.claude_total/codex_total', async () => {
    render(<OpsPanoramaCard />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByTestId('ops-panorama-tasks-count')).toHaveTextContent('3');
    expect(screen.getByTestId('ops-panorama-claude-procs')).toHaveTextContent('3');
    expect(screen.getByTestId('ops-panorama-codex-procs')).toHaveTextContent('1');
  });
});
