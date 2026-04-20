/**
 * InitiativeDetail UI test — Harness v2 M6
 *
 * 覆盖：
 *   1. 渲染 phase / task 卡片 / cost 面板
 *   2. buildMermaid 生成节点 + 边
 *   3. 无 tasks 时提示空状态
 *   4. fetch 失败 → 显示错误
 *   5. phase='done' 时展示完成徽章
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'init-ui-1' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="mocked-mermaid" />' }),
  },
}));

const InitiativeDetail = (await import('../InitiativeDetail')).default;
const { buildMermaid, shortId } = await import('../InitiativeDetail');

function mockFetch(response: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'ERR',
    text: () => Promise.resolve(typeof response === 'string' ? response : ''),
    json: () => Promise.resolve(response),
  });
  global.fetch = fetchMock as typeof global.fetch;
  return fetchMock;
}

function dagFixture(overrides: Record<string, unknown> = {}) {
  return {
    initiative_id: 'init-ui-1',
    phase: 'B_task_loop',
    prd_content: 'PRD',
    contract_content: 'CONTRACT',
    e2e_acceptance: null,
    contract: {
      id: 'c1',
      version: 1,
      status: 'approved',
      review_rounds: 2,
      budget_cap_usd: 10,
      timeout_sec: 21600,
      approved_at: null,
    },
    tasks: [
      {
        task_id: 't1aaaaa1',
        title: 'Task One',
        status: 'completed',
        pr_url: 'https://github.com/x/y/pull/1',
        depends_on: [],
        fix_rounds: 1,
        cost_usd: 0.5,
      },
      {
        task_id: 't2bbbbb2',
        title: 'Task Two',
        status: 'in_progress',
        pr_url: null,
        depends_on: ['t1aaaaa1'],
        fix_rounds: 0,
        cost_usd: 0.3,
      },
    ],
    dependencies: [{ from: 't2bbbbb2', to: 't1aaaaa1', edge_type: 'hard' }],
    cost: {
      total_usd: 0.8,
      by_task: [
        { task_id: 't1aaaaa1', usd: 0.5 },
        { task_id: 't2bbbbb2', usd: 0.3 },
      ],
    },
    timing: {
      started_at: '2026-04-19T10:00:00Z',
      current_phase_started_at: '2026-04-19T10:00:00Z',
      deadline_at: '2026-04-19T16:00:00Z',
      completed_at: null,
    },
    run: {
      id: 'r1',
      current_task_id: 't2bbbbb2',
      merged_task_ids: ['t1aaaaa1'],
      failure_reason: null,
    },
    ...overrides,
  };
}

describe('InitiativeDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('happy path — 渲染 tasks / cost / phase', async () => {
    mockFetch(dagFixture());
    render(<InitiativeDetail />);

    await waitFor(() => {
      expect(screen.getByTestId('initiative-detail')).toBeTruthy();
    });
    expect(screen.getByText('Task One')).toBeTruthy();
    expect(screen.getByText('Task Two')).toBeTruthy();
    expect(screen.getByText('查看 PR')).toBeTruthy();
    expect(screen.getByText('Fix 1 轮')).toBeTruthy();
    // cost 面板
    expect(screen.getByTestId('cost-panel')).toBeTruthy();
    expect(screen.getByText(/\$0\.80/)).toBeTruthy();
  });

  it('phase=done 时显示完成徽章', async () => {
    mockFetch(dagFixture({ phase: 'done' }));
    render(<InitiativeDetail />);
    await waitFor(() => {
      expect(screen.getByTestId('initiative-detail')).toBeTruthy();
    });
    expect(screen.getAllByText(/完成/).length).toBeGreaterThan(0);
  });

  it('tasks 为空时展示空提示', async () => {
    mockFetch(dagFixture({ tasks: [], dependencies: [], cost: { total_usd: 0, by_task: [] } }));
    render(<InitiativeDetail />);
    await waitFor(() => {
      expect(screen.getByTestId('initiative-detail')).toBeTruthy();
    });
    expect(screen.getByText(/暂无子 Task/)).toBeTruthy();
  });

  it('fetch 失败显示错误', async () => {
    mockFetch('boom', false, 500);
    render(<InitiativeDetail />);
    await waitFor(() => {
      expect(screen.getByText(/加载失败/)).toBeTruthy();
    });
  });

  it('e2e_acceptance 含 verdict=FAIL 时渲染 E2EResult 失败场景', async () => {
    mockFetch(
      dagFixture({
        phase: 'failed',
        e2e_acceptance: { verdict: 'FAIL', failed_scenarios: ['scenario-a', 'scenario-b'] },
      })
    );
    render(<InitiativeDetail />);
    await waitFor(() => {
      expect(screen.getByTestId('e2e-result')).toBeTruthy();
    });
    expect(screen.getByText('scenario-a')).toBeTruthy();
    expect(screen.getByText('scenario-b')).toBeTruthy();
  });
});

describe('buildMermaid helper', () => {
  it('空 tasks 返回空串', () => {
    expect(buildMermaid([], [])).toBe('');
  });

  it('生成节点和边，边方向 to→from', () => {
    const src = buildMermaid(
      [
        { task_id: 'aaaaaaa1', title: 'A', status: 'completed', pr_url: null, depends_on: [], fix_rounds: 0, cost_usd: 0 },
        { task_id: 'bbbbbbb2', title: 'B', status: 'queued', pr_url: null, depends_on: [], fix_rounds: 0, cost_usd: 0 },
      ],
      [{ from: 'bbbbbbb2', to: 'aaaaaaa1', edge_type: 'hard' }]
    );
    expect(src).toContain('graph TD');
    expect(src).toContain('aaaaaaa1');
    expect(src).toContain('bbbbbbb2');
    // 边方向：to → from（依赖 to 先完成）
    expect(src).toContain('aaaaaaa1 --> bbbbbbb2');
    // 样式类
    expect(src).toContain('classDef completed');
    expect(src).toContain('classDef queued');
  });

  it('title 含引号/换行时被净化', () => {
    const src = buildMermaid(
      [
        {
          task_id: 'xxxxxxx1',
          title: 'has "quote" and\nnewline',
          status: 'queued',
          pr_url: null,
          depends_on: [],
          fix_rounds: 0,
          cost_usd: 0,
        },
      ],
      []
    );
    expect(src).not.toContain('"quote"');
    expect(src).not.toMatch(/\n\s*newline/);
  });
});

describe('shortId helper', () => {
  it('长 id 截取前 8 字符', () => {
    expect(shortId('1234567890abcdef')).toBe('12345678');
  });
  it('短 id 保留原值', () => {
    expect(shortId('short')).toBe('short');
  });
});
