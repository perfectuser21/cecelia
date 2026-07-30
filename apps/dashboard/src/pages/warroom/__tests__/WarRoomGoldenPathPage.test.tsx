import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
vi.mock('react-router-dom', () => ({ useParams: () => ({ gpId: 'gp-1' }), useNavigate: () => vi.fn() }));
vi.mock('../ConversationsPanel', () => ({ default: ({ journeyId }: { journeyId: string }) => <div>{journeyId}</div> }));
import WarRoomGoldenPathPage from '../WarRoomGoldenPathPage';
const gp = { id: 'gp-1', name: '客服 Golden Path', title: '客服 Golden Path', status: 'delivered', journey_id: 'journey-1' };
const steps = [
  { id: 'step-2', journey_id: 'journey-1', name: '回复客户', step_number: 2 },
  { id: 'step-1', journey_id: 'journey-1', name: '收到消息', step_number: 1 },
];
const urls = ['/api/brain/golden-paths', '/api/brain/journey_steps?journey_id=journey-1',
  '/api/brain/journey_steps/step-1/ledger', '/api/brain/journey_steps/step-2/ledger'];
const reply = (body: unknown, ok = true) => Promise.resolve({
  ok, status: ok ? 200 : 503, json: () => Promise.resolve(body),
} as Response);
type State = 'verified' | 'failed' | 'never_run' | 'not_executable';
const verification = (state: State, extra: Record<string, unknown> = {}) => ({
  state, verified: state === 'verified', last_verified: null, last_run_at: null,
  receipt_id: null, run_id: null, source_sha: null, machine_id: null,
  assertion_current: true, ...extra,
});
const cell = (id: string, key: string, kind: string, assertion: string, state: State, extra = {}) => ({
  link_id: id, cell_key: key, cell_kind: kind, cell_status: 'green',
  assertion_ref: 'tests/gp.test.ts', assertion_state: assertion, na_reason: null,
  verification: verification(state), ...extra,
});
const statusLedgers = {
  'step-1': {
    step: steps[1],
    zones: {
      capability: [cell('verified', '已验证能力', 'capability', 'test', 'verified', {
        verification: verification('verified', {
          last_verified: '2026-07-30T01:00:00Z', source_sha: '1234567890abcdef', machine_id: 'runner-1',
        }),
      })],
      element: [cell('failed', '最近失败要素', 'element', 'test', 'failed', {
        verification: verification('failed', {
          last_verified: '2026-07-29T01:00:00Z', last_run_at: '2026-07-30T02:00:00Z',
        }),
      })],
      scenario: [
        cell('decision', 'Owner 决策', 'scenario', 'decision', 'not_executable'),
        cell('evaluation', '人工评估', 'scenario', 'evaluation', 'not_executable'),
      ],
      base_ref: [],
    },
    coverage: { eligible: 2, verified: 1, failed: 1, never_run: 0, percent: 50 },
  },
  'step-2': {
    step: steps[0],
    zones: { capability: [cell('paper', '纸面绿格', 'capability', 'test', 'never_run')],
      element: [], scenario: [], base_ref: [] },
    coverage: { eligible: 1, verified: 0, failed: 0, never_run: 1, percent: 0 },
  },
};
function install({ paths = [gp], fail = '', byStep = {} }: {
  paths?: unknown[]; fail?: string; byStep?: Record<string, unknown>;
} = {}) {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === urls[0]) return reply({ golden_paths: paths });
    if (url === urls[1]) return reply(steps);
    if (url.endsWith('/ledger')) {
      const id = url.split('/')[4];
      return id === fail ? reply({ error: 'unavailable' }, false) : reply(byStep[id] ?? {
        step: steps.find((value) => value.id === id),
        zones: { capability: [], element: [], scenario: [], base_ref: [] },
        coverage: { eligible: 1, verified: 1, failed: 0, never_run: 0, percent: 100 },
      });
    }
    return reply({}, false);
  }) as typeof fetch;
  return global.fetch as ReturnType<typeof vi.fn>;
}
const calls = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.map(([url]) => url);
describe('WarRoomGoldenPathPage assertion-ledger loading', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);
  it('loads ordered ledgers through the plural GP endpoint', async () => {
    const fetchMock = install(); render(<WarRoomGoldenPathPage />);
    expect(await screen.findByTestId('gp-title')).toHaveTextContent('客服 Golden Path');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(calls(fetchMock)).toEqual(urls);
  });
  it('fails closed when one ledger is unavailable', async () => {
    install({ fail: 'step-2' }); render(<WarRoomGoldenPathPage />);
    expect(await screen.findByText('账本数据不可用')).toBeInTheDocument();
    expect(screen.queryByText('仅纸面断言')).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
  it.each([
    ['missing GP', [], 'GP 不存在或已归档'],
    ['missing journey', [{ ...gp, journey_id: null }], '该 GP 未关联 Journey，账本数据不可用'],
  ])('handles %s without fallback', async (_name, paths, message) => {
    const fetchMock = install({ paths }); render(<WarRoomGoldenPathPage />);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(calls(fetchMock)).toEqual([urls[0]]);
  });
  it('refreshes the complete endpoint chain', async () => {
    const fetchMock = install(); render(<WarRoomGoldenPathPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    fireEvent.click(screen.getByRole('button', { name: '刷新 GP 与断言账本' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(8));
    expect(calls(fetchMock).slice(4)).toEqual(urls);
  });
  it('announces loading and labels icon controls', async () => {
    install(); render(<WarRoomGoldenPathPage />);
    expect(screen.getByRole('status')).toHaveTextContent('加载 GP 与断言账本');
    expect(await screen.findByRole('button', { name: '返回战情室' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新 GP 与断言账本' })).toBeInTheDocument();
  });
});
describe('WarRoomGoldenPathPage assertion verification presentation', () => {
  beforeEach(() => { vi.clearAllMocks(); install({ byStep: statusLedgers }); });
  afterEach(cleanup);
  it('keeps a business-green never-run cell paper gray', async () => {
    render(<WarRoomGoldenPathPage />);
    const paper = await screen.findByLabelText('回复客户，能力，纸面绿格，业务状态 green，仅纸面断言');
    expect(paper).toHaveAttribute('data-verification-state', 'never_run');
    expect(paper).toHaveClass('bg-slate-800/70');
    expect(paper).not.toHaveClass('bg-emerald-500/10');
    expect(within(paper).getByText('仅纸面断言')).toBeInTheDocument();
    expect(screen.getByLabelText('收到消息，能力，已验证能力，业务状态 green，已执行验证'))
      .toHaveClass('bg-emerald-500/10');
  });
  it('marks a previous PASS as historical after the latest failure', async () => {
    render(<WarRoomGoldenPathPage />);
    const failed = await screen.findByLabelText('收到消息，11 要素，最近失败要素，业务状态 green，最近执行失败');
    expect(within(failed).getByText('最近执行失败')).toBeInTheDocument();
    expect(within(failed).getByText(/历史通过：/)).toBeInTheDocument();
    expect(failed).toHaveClass('bg-red-500/10');
  });
  it('shows API coverage without counting semantic cells', async () => {
    render(<WarRoomGoldenPathPage />);
    expect(await screen.findByLabelText('验证覆盖率 50%')).toHaveTextContent('覆盖率 50%');
    expect(screen.getByText('可执行 2 · 已验证 1 · 失败 1 · 未运行 0')).toBeInTheDocument();
    expect(screen.getByText('决策断言')).toBeInTheDocument();
    expect(screen.getByText('评估断言')).toBeInTheDocument();
  });
  it('makes every assertion cell keyboard focusable with a descriptive name', async () => {
    render(<WarRoomGoldenPathPage />); await screen.findByLabelText('验证覆盖率 50%');
    const cells = Array.from(document.querySelectorAll<HTMLElement>('[data-verification-state]'));
    expect(cells).toHaveLength(5);
    cells.forEach((value) => {
      expect(value).toHaveAttribute('tabindex', '0');
      expect(value.getAttribute('aria-label')).toMatch(/业务状态/);
    });
  });
});
