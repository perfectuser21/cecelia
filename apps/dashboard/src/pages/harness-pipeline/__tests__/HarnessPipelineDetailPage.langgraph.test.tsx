/**
 * HarnessPipelineDetailPage — LangGraph 可视化组件测试
 *
 * 覆盖：
 *   1. langgraph.enabled=true 时渲染 "LangGraph" badge
 *   2. GAN Round 1 / Round 2 卡片正确渲染
 *   3. Fix Round 1 卡片正确渲染
 *   4. checkpoints 计数显示
 *   5. langgraph.enabled=false 时不渲染 LangGraph section
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

// Mock react-router-dom（避免 worktree 内 react-router 和 react 双实例冲突）
vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'test-task-lg' }),
  useNavigate: () => vi.fn(),
}));

// Mock mermaid — render 在 happy-dom 下对 SVG 渲染不友好
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="mocked-mermaid" />' }),
  },
}));

// 必须在 vi.mock 之后 import（hoist 顺序）
const HarnessPipelineDetailPage = (await import('../HarnessPipelineDetailPage')).default;

function renderWith(detail: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(detail),
  });
  global.fetch = fetchMock as typeof global.fetch;

  return render(<HarnessPipelineDetailPage />);
}

// 2 轮 GAN + 1 轮 Fix 的假数据
function langgraphDetail() {
  return {
    planner_task_id: 'test-task-lg',
    title: 'LangGraph E2E Test Pipeline',
    description: '',
    user_input: '',
    sprint_dir: 'sprints/test-sprint',
    status: 'completed',
    created_at: '2026-04-19T10:00:00Z',
    stages: [],
    steps: [],
    gan_rounds: [],
    file_contents: {},
    langgraph: {
      enabled: true,
      thread_id: 'test-task-lg-1234567890',
      steps: [],
      gan_rounds: [
        {
          round: 1,
          proposer: { step_index: 2, node: 'proposer', verdict: null, review_round: 1, eval_round: null, review_verdict: null, evaluator_verdict: null, pr_url: null, error: null, timestamp: '2026-04-19T10:01:00Z' },
          reviewer: { step_index: 3, node: 'reviewer', verdict: 'REVISION', review_round: 1, eval_round: null, review_verdict: 'REVISION', evaluator_verdict: null, pr_url: null, error: null, timestamp: '2026-04-19T10:03:00Z' },
        },
        {
          round: 2,
          proposer: { step_index: 4, node: 'proposer', verdict: null, review_round: 2, eval_round: null, review_verdict: null, evaluator_verdict: null, pr_url: null, error: null, timestamp: '2026-04-19T10:04:00Z' },
          reviewer: { step_index: 5, node: 'reviewer', verdict: 'APPROVED', review_round: 2, eval_round: null, review_verdict: 'APPROVED', evaluator_verdict: null, pr_url: null, error: null, timestamp: '2026-04-19T10:05:00Z' },
        },
      ],
      fix_rounds: [
        {
          round: 1,
          generator: { step_index: 6, node: 'generator', verdict: null, review_round: null, eval_round: 0, review_verdict: null, evaluator_verdict: null, pr_url: 'https://github.com/test/pr/1', error: null, timestamp: '2026-04-19T10:06:00Z' },
          evaluator: { step_index: 7, node: 'evaluator', verdict: 'PASS', review_round: null, eval_round: 1, review_verdict: null, evaluator_verdict: 'PASS', pr_url: null, error: null, timestamp: '2026-04-19T10:07:00Z' },
        },
      ],
      checkpoints: {
        count: 3,
        latest_checkpoint_id: 'ckpt-003',
        state_available: true,
      },
      mermaid: 'graph TD\n  Start([START]) --> Planner\n  Planner --> Proposer',
    },
  };
}

function nonLanggraphDetail() {
  return {
    planner_task_id: 'test-task-old',
    title: '老路径 Pipeline',
    description: '',
    user_input: '',
    sprint_dir: 'sprints/old',
    status: 'completed',
    created_at: '2026-04-19T10:00:00Z',
    stages: [],
    steps: [],
    gan_rounds: [],
    file_contents: {},
    langgraph: {
      enabled: false,
      thread_id: 'test-task-old',
      steps: [],
      gan_rounds: [],
      fix_rounds: [],
      checkpoints: { count: 0, latest_checkpoint_id: null, state_available: false },
      mermaid: 'graph TD\n  Start --> End',
    },
  };
}

describe('HarnessPipelineDetailPage — LangGraph 可视化', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('enabled=true 时渲染 LangGraph badge', async () => {
    renderWith(langgraphDetail());
    await waitFor(() => {
      const badges = screen.getAllByText('LangGraph');
      expect(badges.length).toBeGreaterThan(0);
    });
  });

  it('enabled=true 时渲染 GAN Round 1 和 Round 2 卡片', async () => {
    renderWith(langgraphDetail());
    await waitFor(() => {
      expect(screen.getByText(/GAN R1/)).toBeInTheDocument();
      expect(screen.getByText(/GAN R2/)).toBeInTheDocument();
    });
  });

  it('enabled=true 时渲染 Fix Round 1 卡片', async () => {
    renderWith(langgraphDetail());
    await waitFor(() => {
      expect(screen.getByText(/Fix R1/)).toBeInTheDocument();
    });
  });

  it('GAN Round 2 显示 APPROVED verdict 彩标', async () => {
    renderWith(langgraphDetail());
    await waitFor(() => {
      expect(screen.getByText('APPROVED')).toBeInTheDocument();
      expect(screen.getByText('REVISION')).toBeInTheDocument();
    });
  });

  it('checkpoints 计数显示 "3 checkpoints 已保存"', async () => {
    renderWith(langgraphDetail());
    await waitFor(() => {
      expect(screen.getByText(/3 checkpoints 已保存/)).toBeInTheDocument();
    });
  });

  it('PR 链接可点击（来自 generator 步骤）', async () => {
    renderWith(langgraphDetail());
    await waitFor(() => {
      const prLinks = screen.getAllByText('PR');
      expect(prLinks.length).toBeGreaterThan(0);
      const link = prLinks[0] as HTMLAnchorElement;
      expect(link.href).toContain('github.com/test/pr/');
    });
  });

  it('enabled=false 时不渲染 LangGraph badge', async () => {
    renderWith(nonLanggraphDetail());
    // 等页面标题渲染出来
    await waitFor(() => {
      expect(screen.getByText('老路径 Pipeline')).toBeInTheDocument();
    });
    // 没 LangGraph section（badge 和轮次卡片都不应存在）
    expect(screen.queryByText('LangGraph')).toBeNull();
    expect(screen.queryByText(/GAN R1/)).toBeNull();
  });

  it('enabled=true 但 rounds 为空时显示提示文案', async () => {
    const empty = langgraphDetail();
    empty.langgraph.gan_rounds = [];
    empty.langgraph.fix_rounds = [];
    renderWith(empty);
    await waitFor(() => {
      expect(screen.getByText(/尚无 GAN \/ Fix 轮次数据/)).toBeInTheDocument();
    });
  });
});
