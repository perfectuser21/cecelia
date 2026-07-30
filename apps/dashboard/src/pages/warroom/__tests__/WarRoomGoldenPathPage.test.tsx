import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
function install({ paths = [gp], fail = '' }: { paths?: unknown[]; fail?: string } = {}) {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === urls[0]) return reply({ golden_paths: paths });
    if (url === urls[1]) return reply(steps);
    if (url.endsWith('/ledger')) {
      const id = url.split('/')[4];
      return id === fail ? reply({ error: 'unavailable' }, false) : reply({
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
    const fetchMock = install();
    render(<WarRoomGoldenPathPage />);
    expect(await screen.findByTestId('gp-title')).toHaveTextContent('客服 Golden Path');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(calls(fetchMock)).toEqual(urls);
  });
  it('fails closed when one ledger is unavailable', async () => {
    install({ fail: 'step-2' }); render(<WarRoomGoldenPathPage />);
    expect(await screen.findByText('账本数据不可用')).toBeInTheDocument();
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
