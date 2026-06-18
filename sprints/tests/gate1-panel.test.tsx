/**
 * gate1-panel.test.tsx — Cockpit Phase 3 Gate 1 决策面板 + 点火 DOM 测试（happy-dom，TDD Red）
 *
 * 由 contract 产出（Test Contract：DOM 级断言 + 写端点调用断言）。覆盖：
 *  - Gate 1（phase=A_contract）时 decisions 分区扩出 Gate 1 决策面板，列出该 pipeline 待决策项
 *  - 改一条决策保存 → 命中 PUT /api/brain/strategic-decisions/:id（写回 Brain）
 *  - 点「确定点火」→ 命中 POST /api/brain/harness/initiative/:id/fire
 *  - 非 Gate 1（phase=done）→ 确定点火按钮 disabled + 语义化降级提示，不崩页
 *  - Gate 1 无待决策项 → gate1-empty 空态占位，不崩页（PRD 边界 2）
 *  - 改决策保存失败 → gate1-decision-error 内联报错 + 保留输入 + 不崩页（PRD 边界 3）
 *
 * 数据源 wiring（沿用 Phase 2 同一 id 口径）：
 *   /api/brain/harness/runs/:id/progress（phase 判定 Gate 1）
 *   /api/brain/decisions（待决策项）
 *   PUT /api/brain/strategic-decisions/:id（改决策）
 *   POST /api/brain/harness/initiative/:id/fire（点火）
 *   POST /api/brain/harness/initiative/:id/rechallenge（再来一轮）
 *
 * 预期 RED：组件尚无 Gate 1 决策面板 → 6 个用例全部 fail。generator 实现后转 green。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, cleanup, fireEvent } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'pipe-1' }),
  useNavigate: () => vi.fn(),
}));

const HarnessPipelineDetailPage = (await import('../../../apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage')).default;

function pipelineDetail() {
  return {
    planner_task_id: 'pipe-1',
    title: 'Gate1 Pipeline',
    description: '',
    user_input: '',
    sprint_dir: 'sprints/phase3',
    status: 'in_progress',
    created_at: '2026-06-18T10:00:00Z',
    stages: [],
    steps: [],
    gan_rounds: [],
    file_contents: {},
    langgraph: {
      enabled: false,
      thread_id: 'pipe-1',
      steps: [],
      gan_rounds: [],
      fix_rounds: [],
      checkpoints: { count: 0, latest_checkpoint_id: null, state_available: false },
      mermaid: null,
    },
  };
}

function jsonOk(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body) });
}

/**
 * @param opts.phase       progress.phase（'A_contract' = Gate 1；'done' = 非 Gate 1）
 * @param opts.decisions   decisions 数组
 */
function jsonErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, statusText: 'ERR', json: () => Promise.resolve(body) });
}

function installFetch(opts: { phase: string; decisions?: unknown[]; failPut?: boolean; failFire?: boolean }) {
  const calls: { url: string; method: string }[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    calls.push({ url: u, method: (init?.method ?? 'GET').toUpperCase() });
    if (u.includes('/pipeline-detail')) return jsonOk(pipelineDetail());
    if (u.includes('/harness/initiative/') && u.includes('/detail')) {
      return jsonOk({ initiative_id: 'pipe-1', prd_content: '# PRD', contract_content: '## C', gan_rounds: null, step_timing: [], screenshot_urls: [] });
    }
    if (u.includes('/harness/runs/') && u.includes('/progress')) {
      return jsonOk({ initiative_id: 'pipe-1', pct: 40, current_node: 'ganLoop', phase: opts.phase });
    }
    if (u.includes('/strategic-decisions/')) {
      if (opts.failPut) return jsonErr(500, { success: false, error: 'boom' });
      return jsonOk({ success: true, data: { id: 'd1', decision: 'new-val', status: 'active', updated_at: '2026-06-18T10:05:00Z' } });
    }
    if (u.includes('/fire')) {
      if (opts.failFire) return jsonErr(500, { error: 'boom' });
      return jsonOk({ ok: true, initiative_id: 'pipe-1', from_phase: 'A_contract', to_phase: 'B_task_loop', fired_at: '2026-06-18T10:06:00Z' });
    }
    if (u.includes('/rechallenge')) {
      return jsonOk({ ok: true, initiative_id: 'pipe-1', rechallenge_triggered: true, round: 2 });
    }
    if (u.includes('/api/brain/decisions')) return jsonOk(opts.decisions ?? []);
    if (u.includes('/api/brain/tasks/')) return jsonOk({ id: 'pipe-1', payload: { prep_prd_body: '# Prep' } });
    return jsonOk({});
  });
  global.fetch = fetchMock as unknown as typeof global.fetch;
  return { fetchMock, calls };
}

async function openDocsTab() {
  render(<HarnessPipelineDetailPage />);
  await waitFor(() => expect(screen.getByText('Gate1 Pipeline')).toBeInTheDocument());
  fireEvent.click(screen.getByTestId('docs-tab'));
  await waitFor(() => expect(screen.getByTestId('lifecycle-section-decisions')).toBeInTheDocument());
}

const GATE1_DECISIONS = [
  { id: 'd1', decision: '使用 PUT 复用既有端点', target: 'pipe-1', status: 'active' },
];

describe('Gate1 决策面板 + 点火 — Cockpit Phase 3 [BEHAVIOR]', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('Gate 1（phase=A_contract）展开决策面板并列出待决策项', async () => {
    installFetch({ phase: 'A_contract', decisions: GATE1_DECISIONS });
    await openDocsTab();

    const panel = await screen.findByTestId('gate1-decision-panel');
    expect(panel).toBeInTheDocument();
    expect(within(panel).getAllByTestId('gate1-decision-item').length).toBeGreaterThanOrEqual(1);
    // 确定点火按钮在 Gate 1 时可用
    expect(screen.getByTestId('gate1-fire-btn')).toBeEnabled();
  });

  it('改一条决策保存 → 命中 PUT /api/brain/strategic-decisions/:id', async () => {
    const { calls } = installFetch({ phase: 'A_contract', decisions: GATE1_DECISIONS });
    await openDocsTab();

    fireEvent.change(await screen.findByTestId('gate1-decision-edit-input'), { target: { value: 'new-val' } });
    fireEvent.click(screen.getByTestId('gate1-decision-save-btn'));

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/api/brain/strategic-decisions/'))).toBe(true)
    );
  });

  it('点「确定点火」→ 命中 POST /api/brain/harness/initiative/:id/fire', async () => {
    const { calls } = installFetch({ phase: 'A_contract', decisions: GATE1_DECISIONS });
    await openDocsTab();

    fireEvent.click(await screen.findByTestId('gate1-fire-btn'));

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/fire'))).toBe(true)
    );
  });

  it('非 Gate 1（phase=done）→ 确定点火 disabled + 降级提示，不崩页', async () => {
    installFetch({ phase: 'done', decisions: GATE1_DECISIONS });
    await openDocsTab();

    expect(await screen.findByTestId('gate1-fire-btn')).toBeDisabled();
    expect(screen.getByTestId('gate1-fire-disabled-hint')).toBeInTheDocument();
    // 整页不崩：docs 内容容器仍在
    expect(screen.getByTestId('docs-tab-content')).toBeInTheDocument();
  });

  it('Gate 1 但无待决策项 → 显示「暂无待决策」空态占位，不崩页（PRD 边界 2）', async () => {
    installFetch({ phase: 'A_contract', decisions: [] });
    await openDocsTab();

    expect(await screen.findByTestId('gate1-empty')).toBeInTheDocument();
    // 不崩页
    expect(screen.getByTestId('docs-tab-content')).toBeInTheDocument();
  });

  it('改决策保存失败 → 内联报错 + 保留用户输入 + 不崩页（PRD 边界 3）', async () => {
    installFetch({ phase: 'A_contract', decisions: GATE1_DECISIONS, failPut: true });
    await openDocsTab();

    const input = await screen.findByTestId('gate1-decision-edit-input');
    fireEvent.change(input, { target: { value: 'new-val-e2e' } });
    fireEvent.click(screen.getByTestId('gate1-decision-save-btn'));

    // 内联报错可见
    expect(await screen.findByTestId('gate1-decision-error')).toBeInTheDocument();
    // 用户输入保留（不清空）
    expect((screen.getByTestId('gate1-decision-edit-input') as HTMLInputElement).value).toBe('new-val-e2e');
    // 整页不崩
    expect(screen.getByTestId('docs-tab-content')).toBeInTheDocument();
  });
});
