import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const navigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useParams: () => ({ gpId: 'gp-1' }),
  useNavigate: () => navigate,
}));

vi.mock('../ConversationsPanel', () => ({
  default: ({ journeyId }: { journeyId: string }) => (
    <div data-testid="conversations">{journeyId}</div>
  ),
}));

import WarRoomGoldenPathPage from '../WarRoomGoldenPathPage';

const goldenPath = {
  id: 'gp-1',
  name: '客服 Golden Path',
  title: '客服 Golden Path',
  status: 'delivered',
  journey_id: 'journey-1',
};

const steps = [
  { id: 'step-2', journey_id: 'journey-1', name: '回复客户', step_number: 2 },
  { id: 'step-1', journey_id: 'journey-1', name: '收到消息', step_number: 1 },
];

const ledger = (stepId: string) => ({
  step: steps.find((step) => step.id === stepId),
  zones: { capability: [], element: [], scenario: [], base_ref: [] },
  coverage: {
    eligible: 1,
    verified: 1,
    failed: 0,
    never_run: 0,
    percent: 100,
  },
});

function response(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return Promise.resolve({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: () => Promise.resolve(body),
  } as Response);
}

function installFetch(options: { failingLedger?: string } = {}) {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/brain/golden-paths') {
      return response({ success: true, golden_paths: [goldenPath] });
    }
    if (url === '/api/brain/journey_steps?journey_id=journey-1') {
      return response(steps);
    }
    if (url.startsWith('/api/brain/journey_steps/') && url.endsWith('/ledger')) {
      const stepId = url.split('/')[4];
      if (stepId === options.failingLedger) {
        return response({ error: 'ledger unavailable' }, { ok: false, status: 503 });
      }
      return response(ledger(stepId));
    }

    // Current production code reaches this obsolete singular route. Returning a
    // valid body keeps the failure about the missing plural/steps/ledger chain.
    if (url === '/api/brain/golden-path/gp-1') {
      return response({ golden_path: goldenPath });
    }
    return response({ error: `unexpected URL: ${url}` }, { ok: false, status: 404 });
  }) as typeof fetch;

  return global.fetch as ReturnType<typeof vi.fn>;
}

describe('WarRoomGoldenPathPage assertion-ledger loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('resolves the GP through the plural endpoint and loads ordered step ledgers', async () => {
    const fetchMock = installFetch();

    render(<WarRoomGoldenPathPage />);

    expect(await screen.findByTestId('gp-title')).toHaveTextContent('客服 Golden Path');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/brain/golden-paths');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/brain/journey_steps?journey_id=journey-1',
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/brain/journey_steps/step-1/ledger',
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/brain/journey_steps/step-2/ledger',
    );
    expect(fetchMock).not.toHaveBeenCalledWith('/api/brain/golden-path/gp-1');
  });

  it('fails closed when one step ledger is unavailable', async () => {
    installFetch({ failingLedger: 'step-2' });

    render(<WarRoomGoldenPathPage />);

    expect(await screen.findByText('账本数据不可用')).toBeInTheDocument();
    expect(screen.queryByText('仅纸面断言')).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('reports a missing GP from the plural collection without falling back to singular lookup', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/brain/golden-paths') {
        return response({ success: true, golden_paths: [] });
      }
      if (url === '/api/brain/golden-path/gp-1') {
        return response({ golden_path: goldenPath });
      }
      return response({ error: `unexpected URL: ${url}` }, { ok: false, status: 404 });
    });
    global.fetch = fetchMock as typeof fetch;

    render(<WarRoomGoldenPathPage />);

    expect(await screen.findByText('GP 不存在或已归档')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/brain/golden-paths');
  });

  it('fails closed when the resolved GP has no journey_id', async () => {
    const gpWithoutJourney = { ...goldenPath, journey_id: null };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/brain/golden-paths') {
        return response({ success: true, golden_paths: [gpWithoutJourney] });
      }
      if (url === '/api/brain/golden-path/gp-1') {
        return response({ golden_path: gpWithoutJourney });
      }
      return response({ error: `unexpected URL: ${url}` }, { ok: false, status: 404 });
    });
    global.fetch = fetchMock as typeof fetch;

    render(<WarRoomGoldenPathPage />);

    expect(await screen.findByText('该 GP 未关联 Journey，账本数据不可用')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/brain/golden-paths');
  });

  it('refresh reloads the GP, steps, and every ledger', async () => {
    const fetchMock = installFetch();

    render(<WarRoomGoldenPathPage />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    fireEvent.click(screen.getByRole('button', { name: '刷新 GP 与断言账本' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(8));
    expect(fetchMock.mock.calls.slice(4).map(([url]) => url)).toEqual([
      '/api/brain/golden-paths',
      '/api/brain/journey_steps?journey_id=journey-1',
      '/api/brain/journey_steps/step-1/ledger',
      '/api/brain/journey_steps/step-2/ledger',
    ]);
  });

  it('announces loading and gives icon controls accessible names', async () => {
    installFetch();

    render(<WarRoomGoldenPathPage />);

    expect(screen.getByRole('status')).toHaveTextContent('加载 GP 与断言账本');
    expect(await screen.findByRole('button', { name: '返回战情室' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新 GP 与断言账本' })).toBeInTheDocument();
  });
});
