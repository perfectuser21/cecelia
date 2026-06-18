/**
 * TDD Red — Harness Cockpit Phase 3 决策面板 UI（HarnessPipelineDetailPage docs tab）
 *
 * 覆盖（对应合同场景 C）：
 *   - docs tab 决策面板（data-testid=decision-panel）可见
 *   - 每条决策可编辑（decision-edit-input + decision-save-btn）
 *   - 可标记 v1/backlog（decision-scope-v1）
 *   - 「再来一轮」按钮存在（decision-next-round-btn）
 *
 * 红证据：Phase 2 决策面板仍是 read-only，缺上述可编辑/再来一轮 testid → 断言 FAIL。
 * 决策面板升级必须落在 HarnessPipelineDetailPage（非 TaskPrdPage）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'pipeline-phase3' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: vi.fn().mockResolvedValue({ svg: '<svg/>' }) },
}));

const HarnessPipelineDetailPage = (
  await import('../../../apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage')
).default;

const DECISIONS = [
  {
    id: 'd-1', topic: '用什么框架', decision: 'vitest', default_value: 'vitest',
    level: 'step', target: 'pipeline-phase3', scope: 'v1', verify_layer: 'unit',
    round: 1, generated_by: 'cockpit-user',
  },
];

function mockFetch() {
  global.fetch = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/dev/decisions') || u.includes('/decisions')) {
      return { ok: true, status: 200, json: async () => DECISIONS } as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  }) as typeof fetch;
}

describe('Cockpit Phase 3 决策面板 UI [BEHAVIOR:E2E]', () => {
  beforeEach(() => mockFetch());
  afterEach(() => cleanup());

  it('docs tab 渲染可编辑决策面板（含 save / 再来一轮控件）', async () => {
    render(<HarnessPipelineDetailPage />);
    // 切到 docs tab
    const docsTab = await screen.findByTestId('tab-docs');
    docsTab.click();

    await waitFor(() => {
      expect(screen.getByTestId('decision-panel')).toBeTruthy();
    });
    // 可编辑控件
    expect(screen.getByTestId('decision-save-btn')).toBeTruthy();
    expect(screen.getByTestId('decision-edit-input')).toBeTruthy();
    // 标记 v1/backlog
    expect(screen.getByTestId('decision-scope-v1')).toBeTruthy();
    // 再来一轮
    expect(screen.getByTestId('decision-next-round-btn')).toBeTruthy();
  });
});
