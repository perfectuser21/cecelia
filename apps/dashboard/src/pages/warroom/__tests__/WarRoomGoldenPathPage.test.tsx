import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useParams: () => ({ gpId: 'gp-1' }),
  useNavigate: () => navigate,
}));
vi.mock('../ConversationsPanel', () => ({
  default: ({ journeyId }: { journeyId: string }) => <div data-testid="conversations">{journeyId}</div>,
}));
import WarRoomGoldenPathPage from '../WarRoomGoldenPathPage';

const goldenPath = {
  id: 'gp-1', name: '客服 Golden Path', title: '客服 Golden Path',
  status: 'delivered', journey_id: 'journey-1',
};
const steps = [
  { id: 'step-2', journey_id: 'journey-1', name: '回复客户', step_number: 2 },
  { id: 'step-1', journey_id: 'journey-1', name: '收到消息', step_number: 1 },
];
const expectedUrls = [
  '/api/brain/golden-paths',
  '/api/brain/journey_steps?journey_id=journey-1',
  '/api/brain/journey_steps/step-1/ledger',
  '/api/brain/journey_steps/step-2/ledger',
];
const ledger = (stepId: string) => ({
  step: steps.find((step) => step.id === stepId),
  zones: { capability: [], element: [], scenario: [], base_ref: [] },
  coverage: { eligible: 1, verified: 1, failed: 0, never_run: 0, percent: 100 },
});
const response = (body: unknown, ok = true, status = 200) => Promise.resolve({
  ok, status, json: () => Promise.resolve(body),
} as Response);

function installFetch(options: {
  failingLedger?: string;
  goldenPaths?: Array<typeof goldenPath | { journey_id: null }>;
} = {}) {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === expectedUrls[0]) return response({
      success: true, golden_paths: options.goldenPaths ?? [goldenPath],
    });
    if (url === expectedUrls[1]) return response(steps);
    if (url.startsWith('/api/brain/journey_steps/') && url.endsWith('/ledger')) {
      const stepId = url.split('/')[4];
      return stepId === options.failingLedger
        ? response({ error: 'ledger unavailable' }, false, 503)
        : response(ledger(stepId));
    }
    if (url === '/api/brain/golden-path/gp-1') return response({ golden_path: goldenPath });
    return response({ error: `unexpected URL: ${url}` }, false, 404);
  }) as typeof fetch;
  return global.fetch as ReturnType<typeof vi.fn>;
}

const calledUrls = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.map(([url]) => url);

describe('WarRoomGoldenPathPage assertion-ledger loading', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('resolves the GP through the plural endpoint and loads ordered step ledgers', async () => {
    const fetchMock = installFetch();
    render(<WarRoomGoldenPathPage />);
    expect(await screen.findByTestId('gp-title')).toHaveTextContent('客服 Golden Path');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(calledUrls(fetchMock)).toEqual(expectedUrls);
    expect(calledUrls(fetchMock)).not.toContain('/api/brain/golden-path/gp-1');
  });

  it('fails closed when one step ledger is unavailable', async () => {
    installFetch({ failingLedger: 'step-2' });
    render(<WarRoomGoldenPathPage />);
    expect(await screen.findByText('账本数据不可用')).toBeInTheDocument();
    expect(screen.queryByText('仅纸面断言')).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it.each([
    ['reports a missing GP', [], 'GP 不存在或已归档'],
    ['fails closed without journey_id', [{ ...goldenPath, journey_id: null }], '该 GP 未关联 Journey，账本数据不可用'],
  ])('%s without singular fallback', async (_name, goldenPaths, message) => {
    const fetchMock = installFetch({ goldenPaths });
    render(<WarRoomGoldenPathPage />);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(calledUrls(fetchMock)).toEqual(['/api/brain/golden-paths']);
  });

  it('refresh reloads the GP, steps, and every ledger', async () => {
    const fetchMock = installFetch();
    render(<WarRoomGoldenPathPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    fireEvent.click(screen.getByRole('button', { name: '刷新 GP 与断言账本' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(8));
    expect(calledUrls(fetchMock).slice(4)).toEqual(expectedUrls);
  });

  it('announces loading and gives icon controls accessible names', async () => {
    installFetch();
    render(<WarRoomGoldenPathPage />);
    expect(screen.getByRole('status')).toHaveTextContent('加载 GP 与断言账本');
    expect(await screen.findByRole('button', { name: '返回战情室' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新 GP 与断言账本' })).toBeInTheDocument();
  });
});
