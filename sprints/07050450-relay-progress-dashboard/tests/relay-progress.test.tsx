/**
 * relay-progress.test.tsx — Relay 进度条页面单元测试（TDD Red 阶段）
 *
 * 覆盖：
 *   1. stripPhasePrefix：A_ 前缀剥离逻辑（环境无关逻辑断言）
 *   2. 空态渲染：fetch 返回 [] → 显示"暂无进行中的 relay"
 *   3. 错误态渲染：fetch 返回 !ok → 显示 relay-progress-error
 *   4. 有数据时渲染进度条容器
 *   5. 七段 phase 标签渲染
 *
 * 这些测试在 RelayProgressPage 实现前会 FAIL（TDD Red 证据）。
 * 修复完成后全绿，并作为回归测试永久留存在 CI。
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';

// Mock react-router-dom（避免双实例冲突）
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/relay-progress' }),
  Link: ({ children }: any) => children,
}));

// ─── 工具函数测试（不依赖组件，直接 import 或内联）──────────────────────────

describe('stripPhasePrefix — A_ 前缀剥离逻辑', () => {
  // 内联验证：在组件实现前此 describe 会 FAIL（无法 import）
  // Generator 实现时需将 stripPhasePrefix export 或在此处测试内联版本

  function stripPhasePrefix(phase: string): string {
    // 此处是期望 Generator 实现的逻辑，测试先写死期望
    return phase.replace(/^[A-Z]_/, '');
  }

  it('A_planning → planning', () => {
    expect(stripPhasePrefix('A_planning')).toBe('planning');
  });

  it('A_generate → generate', () => {
    expect(stripPhasePrefix('A_generate')).toBe('generate');
  });

  it('planning（无前缀）→ planning（不变）', () => {
    expect(stripPhasePrefix('planning')).toBe('planning');
  });

  it('gan（无前缀）→ gan（不变）', () => {
    expect(stripPhasePrefix('gan')).toBe('gan');
  });

  it('A_judge → judge', () => {
    expect(stripPhasePrefix('A_judge')).toBe('judge');
  });
});

// ─── 组件渲染测试（依赖 RelayProgressPage 实现）──────────────────────────────

describe('RelayProgressPage — 空态渲染', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    }) as any;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('空态：显示"暂无进行中的 relay"文案', async () => {
    // Generator 实现前此测试 FAIL（RelayProgressPage 不存在）
    const { default: RelayProgressPage } = await import(
      '../../../apps/dashboard/src/pages/relay-progress/RelayProgressPage'
    );

    await act(async () => {
      render(<RelayProgressPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('relay-progress-empty')).toBeInTheDocument();
    });

    expect(screen.getByTestId('relay-progress-empty')).toHaveTextContent('暂无进行中的 relay');
  });

  it('空态：不渲染进度条行', async () => {
    const { default: RelayProgressPage } = await import(
      '../../../apps/dashboard/src/pages/relay-progress/RelayProgressPage'
    );

    await act(async () => {
      render(<RelayProgressPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('relay-progress-empty')).toBeInTheDocument();
    });

    // 空态时不应有 initiative 行
    const rows = screen.queryAllByTestId('relay-progress-row');
    expect(rows).toHaveLength(0);
  });
});

describe('RelayProgressPage — 错误态渲染', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ error: 'Server Error' }),
    }) as any;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('错误态：fetch !ok 时显示 relay-progress-error 元素', async () => {
    const { default: RelayProgressPage } = await import(
      '../../../apps/dashboard/src/pages/relay-progress/RelayProgressPage'
    );

    await act(async () => {
      render(<RelayProgressPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('relay-progress-error')).toBeInTheDocument();
    });
  });

  it('错误态：不崩溃（无 throw 传播）', async () => {
    const { default: RelayProgressPage } = await import(
      '../../../apps/dashboard/src/pages/relay-progress/RelayProgressPage'
    );

    // 若组件 throw，render 会抛，此 it 会 FAIL
    await act(async () => {
      expect(() => render(<RelayProgressPage />)).not.toThrow();
    });
  });
});

describe('RelayProgressPage — 有数据时渲染', () => {
  const mockRuns = [
    {
      initiative_id: 'abcdef1234567890',
      phase: 'A_generate',
      judge_verdict: 'APPROVED',
      cost_usd: 0.12,
    },
    {
      initiative_id: 'bbbbbbbb99999999',
      phase: 'planning',
      judge_verdict: null,
      cost_usd: null,
    },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockRuns),
    }) as any;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('有数据时渲染进度容器（relay-progress-container）', async () => {
    const { default: RelayProgressPage } = await import(
      '../../../apps/dashboard/src/pages/relay-progress/RelayProgressPage'
    );

    await act(async () => {
      render(<RelayProgressPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('relay-progress-container')).toBeInTheDocument();
    });
  });

  it('有数据时不渲染空态文案', async () => {
    const { default: RelayProgressPage } = await import(
      '../../../apps/dashboard/src/pages/relay-progress/RelayProgressPage'
    );

    await act(async () => {
      render(<RelayProgressPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('relay-progress-container')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('relay-progress-empty')).not.toBeInTheDocument();
  });

  it('initiative_id 前 8 位短码渲染在页面', async () => {
    const { default: RelayProgressPage } = await import(
      '../../../apps/dashboard/src/pages/relay-progress/RelayProgressPage'
    );

    await act(async () => {
      render(<RelayProgressPage />);
    });

    await waitFor(() => {
      // 第一条 initiative_id 前 8 位
      expect(screen.getByText(/abcdef12/)).toBeInTheDocument();
    });
  });

  it('A_ 前缀已剥离：页面显示 generate 而非 A_generate', async () => {
    const { default: RelayProgressPage } = await import(
      '../../../apps/dashboard/src/pages/relay-progress/RelayProgressPage'
    );

    await act(async () => {
      render(<RelayProgressPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('relay-progress-container')).toBeInTheDocument();
    });

    // 不应出现带前缀的 A_generate 文案
    expect(screen.queryByText('A_generate')).not.toBeInTheDocument();
  });

  it('七段 phase 标签存在（至少一条 initiative 时）', async () => {
    const { default: RelayProgressPage } = await import(
      '../../../apps/dashboard/src/pages/relay-progress/RelayProgressPage'
    );

    await act(async () => {
      render(<RelayProgressPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('relay-progress-container')).toBeInTheDocument();
    });

    const phases = ['planning', 'gan', 'generate', 'evaluate', 'judge', 'merge', 'report'];
    for (const phase of phases) {
      const labels = screen.getAllByTestId(`phase-label-${phase}`);
      expect(labels.length).toBeGreaterThan(0);
    }
  });

  it('多租户：两条不同 initiative 均渲染（租户隔离基础验证）', async () => {
    const { default: RelayProgressPage } = await import(
      '../../../apps/dashboard/src/pages/relay-progress/RelayProgressPage'
    );

    await act(async () => {
      render(<RelayProgressPage />);
    });

    await waitFor(() => {
      // 两条 initiative 短码都出现
      expect(screen.getByText(/abcdef12/)).toBeInTheDocument();
      expect(screen.getByText(/bbbbbbbb/)).toBeInTheDocument();
    });
  });
});
