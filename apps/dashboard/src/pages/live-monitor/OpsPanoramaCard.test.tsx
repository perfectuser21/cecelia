import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { OpsPanoramaCard, type OpsPanoramaData } from './OpsPanoramaCard';

const PANORAMA: OpsPanoramaData = {
  sampled_at: '2026-10-31T07:59:45Z',
  tasks: { in_progress_count: 3, vendor_dist: { claude: 2, codex: 1 } },
  relay: { container_count: 4 },
  sessions: { headed: 1, headless: 2 },
  host: { cpu_usage_pct: 55.2, mem_used_pct: 72.1 },
  processes: { claude_total: 3, codex_total: 1 },
  llm_capacity: {
    sentinel: 'ok',
    vendors: {
      claude: {
        available_count: 2, total_count: 3,
        accounts: [
          { id: 'account1', name: '账号一', available: true, five_hour_pct: 30 },
          { id: 'account2', available: true, five_hour_pct: 55 },
          { id: 'account3', available: false, five_hour_pct: 85 },
        ],
      },
      codex: { available_count: 1, total_count: 5, accounts: [] },
      grok: { available_count: 0, total_count: 2, accounts: [] },
    },
  },
};
const mockFetch = vi.fn<typeof fetch>();

function respond(data: OpsPanoramaData) {
  mockFetch.mockImplementation(async () => new Response(JSON.stringify(data), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
}

async function showCard() {
  const view = render(<OpsPanoramaCard />);
  await act(async () => {});
  return view;
}

describe('OpsPanoramaCard 真实组件', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T08:00:00Z'));
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    respond(PANORAMA);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('BEHAVIOR-16/22: 从全景接口展示标题、任务、进程和Relay数量', async () => {
    await showCard();
    expect(mockFetch).toHaveBeenCalledWith('/api/brain/ops-panorama');
    expect(screen.getByTestId('ops-panorama-title')).toHaveTextContent('执行全景');
    expect(screen.getByTestId('ops-panorama-tasks-count')).toHaveTextContent(/^3$/);
    expect(screen.getByTestId('ops-panorama-claude-procs')).toHaveTextContent(/^3$/);
    expect(screen.getByTestId('ops-panorama-codex-procs')).toHaveTextContent(/^1$/);
    expect(screen.getByTestId('ops-panorama-relay')).toHaveTextContent(/^4$/);
  });

  it('BEHAVIOR-17: 30秒前保持当前数据，30秒时更新，卸载后停止轮询', async () => {
    const view = await showCard();
    respond({ ...PANORAMA, tasks: { ...PANORAMA.tasks, in_progress_count: 7 } });
    await act(async () => { await vi.advanceTimersByTimeAsync(29999); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('ops-panorama-tasks-count')).toHaveTextContent(/^3$/);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('ops-panorama-tasks-count')).toHaveTextContent(/^7$/);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('BEHAVIOR-18: CPU和内存进度条数值与显示百分比一致', async () => {
    await showCard();
    expect(screen.getByRole('progressbar', { name: 'CPU' })).toHaveAttribute('aria-valuenow', '55.2');
    expect(screen.getByRole('progressbar', { name: 'MEM' })).toHaveAttribute('aria-valuenow', '72.1');
    expect(screen.getByTestId('ops-panorama-cpu-value')).toHaveTextContent('55.2%');
    expect(screen.getByTestId('ops-panorama-mem-value')).toHaveTextContent('72.1%');
  });

  it.each([
    [30, '#10b981'], [50, '#10b981'], [51, '#f59e0b'],
    [80, '#f59e0b'], [81, '#ef4444'], [85, '#ef4444'],
  ])('BEHAVIOR-19: 使用率 %s 的账号显示对应颜色 %s', async (pct, color) => {
    respond({ ...PANORAMA, llm_capacity: {
      sentinel: 'ok', vendors: { claude: {
        available_count: 1, total_count: 1,
        accounts: [{ id: 'boundary', name: '边界账号', available: true, five_hour_pct: pct }],
      } },
    } });
    await showCard();
    const bar = screen.getByRole('progressbar', { name: 'boundary usage' });
    expect(bar).toHaveAttribute('aria-valuenow', String(pct));
    expect(bar.firstElementChild).toHaveStyle({ background: color, width: `${pct}%` });
    expect(screen.getByText('边界账号')).toBeInTheDocument();
    expect(screen.getByText(`${pct}%`)).toBeInTheDocument();
  });

  it.each([
    ['2026-10-31T07:59:45Z', '15s 前'],
    ['2026-10-31T07:58:00Z', '2m 前'],
    ['2026-10-31T06:00:00Z', '2h 前'],
  ])('BEHAVIOR-20: 抓取时间%s显示为%s', async (sampled_at, expected) => {
    respond({ ...PANORAMA, sampled_at });
    await showCard();
    expect(screen.getByTestId('ops-panorama-sampled-at')).toHaveTextContent(expected);
  });

  it('BEHAVIOR-21: Relay未知与LLM容量为空时仍展示其余指标', async () => {
    respond({ ...PANORAMA, relay: { container_count: null }, llm_capacity: null });
    await showCard();
    expect(screen.getByTestId('ops-panorama-relay')).toHaveTextContent('—');
    expect(screen.queryByText('LLM 容量')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'CPU' })).toHaveAttribute('aria-valuenow', '55.2');
  });

  it('请求失败时保留上次成功数据，下次轮询仍能恢复', async () => {
    await showCard();
    mockFetch.mockRejectedValueOnce(new Error('离线'));
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(screen.getByTestId('ops-panorama-tasks-count')).toHaveTextContent(/^3$/);
    respond({ ...PANORAMA, tasks: { ...PANORAMA.tasks, in_progress_count: 9 } });
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(screen.getByTestId('ops-panorama-tasks-count')).toHaveTextContent(/^9$/);
  });

  it.each([
    { label: 'null', payload: null, status: 200 },
    { label: '数组', payload: [], status: 200 },
    { label: 'HTTP错误', payload: { error: '服务不可用' }, status: 503 },
  ])('拒绝$label响应，保持加载状态', async ({ payload, status }) => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify(payload), {
      status,
    }));
    await showCard();
    expect(screen.getByTestId('ops-panorama-loading')).toHaveTextContent('加载中');
    expect(screen.queryByTestId('ops-panorama-card')).not.toBeInTheDocument();
  });
});
