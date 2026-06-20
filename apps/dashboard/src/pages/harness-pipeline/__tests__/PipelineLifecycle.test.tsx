/**
 * PipelineLifecycle.test.tsx — Cockpit Phase 2 全生命周期视图 DOM 测试（happy-dom）
 *
 * 由 generator 编写（合同 Test Contract：DOM 级断言）。覆盖：
 *  - PrepPRD 分区显示 DB 全文并 Markdown 渲染（h1 真实元素，非 <pre> 原文）
 *  - 全页不出现裸「文件不存在」死字（负向断言）
 *  - 单项 Brain API 取数失败 → 该分区降级为「取数失败」占位、整页不崩
 *  - PrepPRD 渲染内容等于 DB 注入指纹（防硬编码造假）
 *
 * 数据源 wiring：docs tab 激活后 PipelineLifecycleSection 逐项 fetch：
 *   /api/brain/tasks/:id（prep_prd_body）
 *   /api/brain/harness/initiative/:id/detail（prd_content/contract_content）
 *   /api/brain/harness/runs/:id/progress
 *   /api/brain/decisions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, cleanup, fireEvent } from '@testing-library/react';

// Mock react-router-dom（避免 worktree 内双实例冲突；与同目录 langgraph 测试一致）
vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'pipe-1' }),
  useNavigate: () => vi.fn(),
}));

const HarnessPipelineDetailPage = (await import('../HarnessPipelineDetailPage')).default;

// pipeline-detail：页面骨架（标题/tab 渲染所需）
function pipelineDetail() {
  return {
    planner_task_id: 'pipe-1',
    title: 'Phase2 Lifecycle Pipeline',
    description: '',
    user_input: '',
    sprint_dir: 'sprints/phase2',
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
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  });
}

function jsonFail(status: number) {
  return Promise.resolve({
    ok: false,
    status,
    statusText: 'ERR',
    json: () => Promise.resolve({ error: 'fail' }),
  });
}

/**
 * 按 URL 路由的 fetch mock。
 * @param opts.prepBody     payload.prep_prd_body（PrepPRD 源）
 * @param opts.prd          initiative.prd_content（正式 PRD 源）
 * @param opts.contract     initiative.contract_content（Contract 源）
 * @param opts.decisions    decisions 数组
 * @param opts.failInitiative  让 /initiative/:id/detail 取数失败（404）
 */
function installFetch(opts: {
  prepBody?: string | null;
  prd?: string | null;
  contract?: string | null;
  decisions?: unknown[];
  failInitiative?: boolean;
  reportContent?: unknown;
}) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes('/pipeline-detail')) return jsonOk(pipelineDetail());
    if (u.includes('/harness/initiative/') && u.includes('/detail')) {
      if (opts.failInitiative) return jsonFail(404);
      return jsonOk({
        initiative_id: 'pipe-1',
        prd_content: opts.prd ?? null,
        contract_content: opts.contract ?? null,
        gan_rounds: null,
        report_content: opts.reportContent ?? null,
        step_timing: [],
        screenshot_urls: [],
      });
    }
    if (u.includes('/harness/runs/') && u.includes('/progress')) {
      return jsonOk({ initiative_id: 'pipe-1', pct: 65, current_node: 'generator', phase: 'running' });
    }
    if (u.includes('/api/brain/decisions')) return jsonOk(opts.decisions ?? []);
    if (u.includes('/api/brain/tasks/')) {
      return jsonOk({ id: 'pipe-1', payload: { prep_prd_body: opts.prepBody ?? null } });
    }
    return jsonOk({});
  });
  global.fetch = fetchMock as unknown as typeof global.fetch;
  return fetchMock;
}

async function openDocsTab() {
  render(<HarnessPipelineDetailPage />);
  await waitFor(() => expect(screen.getByText('Phase2 Lifecycle Pipeline')).toBeInTheDocument());
  fireEvent.click(screen.getByTestId('docs-tab'));
  await waitFor(() => expect(screen.getByTestId('lifecycle-section-prep_prd')).toBeInTheDocument());
}

describe('PipelineLifecycle — Cockpit Phase 2 [BEHAVIOR]', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('PrepPRD 显示 DB 全文并 Markdown 渲染', async () => {
    installFetch({
      prepBody: '# 顶层标题\n\n这是来自 DB 的完整正文段落。\n\n- 第一条\n- 第二条',
      prd: '# 正式 PRD 内容',
      contract: '## Contract 断言',
    });
    await openDocsTab();

    const prep = screen.getByTestId('lifecycle-section-prep_prd');
    // 全文片段来自 DB
    expect(within(prep).getByText('这是来自 DB 的完整正文段落。')).toBeInTheDocument();
    // Markdown 渲染为真实 h1 元素（非 <pre> 原文）
    const h1 = within(prep).getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('顶层标题');
    // 无字面 '# ' 残留（证明真渲染而非纯文本回显）
    expect(prep.textContent).not.toContain('# 顶层标题');
  });

  it('全页不出现文件不存在死字', async () => {
    // 混合数据：PrepPRD 有内容、Report 未产出（→ 未到该步）、decisions 空（→ 暂无决策）
    installFetch({
      prepBody: '# 有内容',
      prd: '# PRD',
      contract: '## Contract',
      decisions: [],
    });
    await openDocsTab();

    // 核心负向断言：全页 DOM 不含旧死字「文件不存在」
    expect(screen.queryByText('文件不存在')).toBeNull();

    // 缺失项走语义化占位
    const report = screen.getByTestId('lifecycle-section-report');
    expect(within(report).getByText('未到该步')).toBeInTheDocument();
    const decisions = screen.getByTestId('lifecycle-section-decisions');
    expect(within(decisions).getByText('暂无决策')).toBeInTheDocument();
  });

  it('单项取数失败降级占位不崩页', async () => {
    // /initiative/:id/detail 取数失败 → sprint_prd / contract 分区显示「取数失败」
    installFetch({
      prepBody: '# Prep 仍正常',
      failInitiative: true,
      decisions: [],
    });
    await openDocsTab();

    const contract = screen.getByTestId('lifecycle-section-contract');
    expect(within(contract).getByText('取数失败')).toBeInTheDocument();
    // 取数失败 ≠ 未到该步（接线错误必须可见，Risk a/b）
    expect(within(contract).queryByText('未到该步')).toBeNull();

    const prd = screen.getByTestId('lifecycle-section-sprint_prd');
    expect(within(prd).getByText('取数失败')).toBeInTheDocument();

    // 整页不崩：其余分区仍渲染（PrepPRD 正常）
    const prep = screen.getByTestId('lifecycle-section-prep_prd');
    expect(within(prep).getByText('Prep 仍正常')).toBeInTheDocument();
    expect(screen.getByTestId('docs-tab-content')).toBeInTheDocument();
  });

  it('Report 分区渲染 Sprint 产物契约真数据', async () => {
    // 注入完整契约对象 → Report 分区应渲染 verdict/change_summary/next_action/
    // total_cost/node_telemetry 表/失败场景/发现四类，且不再显示「未到该步」。
    installFetch({
      prepBody: '# Prep',
      prd: '# PRD',
      contract: '## Contract',
      reportContent: {
        contract_version: 1,
        initiative_id: 'pipe-1',
        verdict: 'PASS',
        change_summary: '展示报告契约真数据-FINGERPRINT',
        next_action: '推进下一步动作',
        total_cost: 2.5,
        failed_scenarios: ['失败场景甲乙丙'],
        incidental_bugs: ['撞见的 bug X'],
        improvement_items: ['改进项 Y'],
        linked_issues: ['ISSUE-9999'],
        open_issues_with_learnings: ['未解决 issue Z'],
        node_telemetry: [{ node: 'proposer', start_ts: null, end_ts: null, tokens: 888, cost: null }],
        produced_assets: { skills: [], tests: [], decisions: [] },
      },
      decisions: [],
    });
    await openDocsTab();

    const report = screen.getByTestId('lifecycle-section-report');
    // 真数据全部出现
    expect(within(report).getByText('展示报告契约真数据-FINGERPRINT')).toBeInTheDocument();
    expect(within(report).getByText('推进下一步动作')).toBeInTheDocument();
    expect(within(report).getByText('失败场景甲乙丙')).toBeInTheDocument();
    expect(within(report).getByText('撞见的 bug X')).toBeInTheDocument();
    expect(within(report).getByText('ISSUE-9999')).toBeInTheDocument();
    // node_telemetry 渲染为表格（proposer 节点名 + tokens）
    expect(within(report).getByText('proposer')).toBeInTheDocument();
    expect(within(report).getByText('888')).toBeInTheDocument();
    // 有真数据时绝不显示「未到该步」
    expect(within(report).queryByText('未到该步')).toBeNull();
  });

  it('PrepPRD 渲染等于DB注入指纹非硬编码', async () => {
    // 注入唯一指纹 → 必须出现在 DOM（证明数据真来自 DB 字段，非写死占位）
    const fingerprint = 'PREP-PRD-FINGERPRINT-7f3a9c21';
    installFetch({
      prepBody: `# PrepPRD\n\n${fingerprint}`,
      prd: '# PRD',
      contract: '## Contract',
    });
    await openDocsTab();

    const prep = screen.getByTestId('lifecycle-section-prep_prd');
    expect(within(prep).getByText(fingerprint)).toBeInTheDocument();
    // 对照：未注入的无关指纹不应出现（排除硬编码假数据）
    expect(within(prep).queryByText('PREP-PRD-FINGERPRINT-deadbeef')).toBeNull();
  });
});
