/**
 * test-pyramid.test.tsx — 测试金字塔页面单元测试（TDD Red 阶段）
 *
 * 覆盖三态（mock fetch，照 relay-progress 测法）：
 *   1. 绿态：guard pass → 三层计数卡 + 孤儿数 + 未挂跑道数 + PASS 徽章 + generated 时间
 *   2. 红态：guard fail → 醒目红条 + failures 列表
 *   3. 灰态：fetch 失败或 available:false → "guard 数据不可用"
 *
 * 实现前这些测试 FAIL（TDD Red 证据），实现后全绿并永久留在 CI 作回归。
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';

// Mock react-router-dom（避免双实例冲突）
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/test-pyramid' }),
  Link: ({ children }: any) => children,
}));

const passPayload = {
  available: true,
  pass: true,
  failures: [],
  orphans: { tests: 0, e2e: 0, total: 3 },
  smoke: { total: 2, unwired: [] },
  permanent: { total: 1123, layers: { unit: 1020, integration: 103 } },
  panel: { fresh: true, generated: '2026-07-14 10:59:31' },
};

const failPayload = {
  ...passPayload,
  pass: false,
  failures: ['tests/foo.test.ts 未挂任何跑道', 'e2e/bar.spec.ts 是孤儿'],
  smoke: { total: 2, unwired: ['e2e/bar.spec.ts'] },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TestPyramidPage — 绿态（guard PASS）', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(passPayload),
    }) as any;
  });

  it('渲染三层计数卡：unit/integration/e2e-smoke', async () => {
    const { default: TestPyramidPage } = await import('../TestPyramidPage');

    await act(async () => {
      render(<TestPyramidPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('pyramid-layer-unit')).toBeInTheDocument();
    });

    expect(screen.getByTestId('pyramid-layer-unit')).toHaveTextContent('1020');
    expect(screen.getByTestId('pyramid-layer-integration')).toHaveTextContent('103');
    expect(screen.getByTestId('pyramid-layer-e2e-smoke')).toHaveTextContent('2');
  });

  it('渲染孤儿数与未挂跑道数', async () => {
    const { default: TestPyramidPage } = await import('../TestPyramidPage');

    await act(async () => {
      render(<TestPyramidPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('pyramid-orphans')).toBeInTheDocument();
    });

    expect(screen.getByTestId('pyramid-orphans')).toHaveTextContent('3');
    expect(screen.getByTestId('pyramid-unwired')).toHaveTextContent('0');
  });

  it('守卫 PASS 徽章存在，且无红条', async () => {
    const { default: TestPyramidPage } = await import('../TestPyramidPage');

    await act(async () => {
      render(<TestPyramidPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('pyramid-guard-pass')).toBeInTheDocument();
    });

    expect(screen.getByTestId('pyramid-guard-pass')).toHaveTextContent('PASS');
    expect(screen.queryByTestId('pyramid-guard-fail')).not.toBeInTheDocument();
  });

  it('渲染 panel.generated 时间', async () => {
    const { default: TestPyramidPage } = await import('../TestPyramidPage');

    await act(async () => {
      render(<TestPyramidPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('pyramid-generated')).toBeInTheDocument();
    });

    expect(screen.getByTestId('pyramid-generated')).toHaveTextContent('2026-07-14 10:59:31');
  });
});

describe('TestPyramidPage — 红态（guard FAIL）', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(failPayload),
    }) as any;
  });

  it('渲染红条与 FAIL 标记', async () => {
    const { default: TestPyramidPage } = await import('../TestPyramidPage');

    await act(async () => {
      render(<TestPyramidPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('pyramid-guard-fail')).toBeInTheDocument();
    });

    expect(screen.getByTestId('pyramid-guard-fail')).toHaveTextContent('FAIL');
    expect(screen.queryByTestId('pyramid-guard-pass')).not.toBeInTheDocument();
  });

  it('failures 列表逐条渲染', async () => {
    const { default: TestPyramidPage } = await import('../TestPyramidPage');

    await act(async () => {
      render(<TestPyramidPage />);
    });

    await waitFor(() => {
      const items = screen.getAllByTestId('pyramid-failure-item');
      expect(items).toHaveLength(2);
    });

    expect(screen.getByText(/tests\/foo\.test\.ts 未挂任何跑道/)).toBeInTheDocument();
    expect(screen.getByText(/e2e\/bar\.spec\.ts 是孤儿/)).toBeInTheDocument();
  });

  it('红态仍渲染三层计数卡（数据照常展示）', async () => {
    const { default: TestPyramidPage } = await import('../TestPyramidPage');

    await act(async () => {
      render(<TestPyramidPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('pyramid-layer-unit')).toBeInTheDocument();
    });

    expect(screen.getByTestId('pyramid-unwired')).toHaveTextContent('1');
  });
});

describe('TestPyramidPage — 灰态（数据不可用）', () => {
  it('available:false → 显示"guard 数据不可用"', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ available: false, error: 'spawn node ETIMEDOUT' }),
    }) as any;

    const { default: TestPyramidPage } = await import('../TestPyramidPage');

    await act(async () => {
      render(<TestPyramidPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('pyramid-unavailable')).toBeInTheDocument();
    });

    expect(screen.getByTestId('pyramid-unavailable')).toHaveTextContent('guard 数据不可用');
  });

  it('fetch !ok → 灰态，不崩溃', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({}),
    }) as any;

    const { default: TestPyramidPage } = await import('../TestPyramidPage');

    await act(async () => {
      expect(() => render(<TestPyramidPage />)).not.toThrow();
    });

    await waitFor(() => {
      expect(screen.getByTestId('pyramid-unavailable')).toBeInTheDocument();
    });
  });

  it('fetch 网络异常（reject）→ 灰态', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any;

    const { default: TestPyramidPage } = await import('../TestPyramidPage');

    await act(async () => {
      render(<TestPyramidPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('pyramid-unavailable')).toBeInTheDocument();
    });
  });
});
