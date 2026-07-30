import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const routeParams = vi.hoisted(() => ({ gpId: 'gp-1' }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ gpId: routeParams.gpId }),
  useNavigate: () => vi.fn(),
}));
vi.mock('../ConversationsPanel', () => ({
  default: ({ journeyId }: { journeyId: string }) => <div data-testid="conversations">{journeyId}</div>,
}));
import WarRoomGoldenPathPage from '../WarRoomGoldenPathPage';

const responseObject = (body: unknown, ok = true, status = 200) => ({
  ok, status, json: () => Promise.resolve(body),
} as Response);
const response = (body: unknown, ok = true, status = 200) =>
  Promise.resolve(responseObject(body, ok, status));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const gp = (id: string, title: string, journeyId: string) => ({
  id, name: title, title, status: 'delivered', journey_id: journeyId,
});
const step = (id: string, journeyId: string, name: string) => ({
  id, journey_id: journeyId, name, step_number: 1,
});
const ledger = (stepValue: ReturnType<typeof step>, cellKey: string) => ({
  step: stepValue,
  zones: {
    capability: [{
      link_id: `cell-${stepValue.id}`, cell_kind: 'capability', cell_key: cellKey,
      cell_status: 'green', assertion_ref: 'tests/gp.test.ts', assertion_state: 'test',
      na_reason: null,
      verification: {
        state: 'never_run', verified: false, last_verified: null, last_run_at: null,
        receipt_id: null, run_id: null, source_sha: null, machine_id: null,
        assertion_current: true,
      },
    }],
    element: [], scenario: [], base_ref: [],
  },
  coverage: { eligible: 1, verified: 0, failed: 0, never_run: 1, percent: 0 },
});
type Ledger = ReturnType<typeof ledger>;
const mutateCell = (value: Ledger, transform: (cell: Ledger['zones']['capability'][number]) => unknown) => ({
  ...value,
  zones: { ...value.zones, capability: value.zones.capability.map(transform) },
});
function installContractFetch(gpValue: unknown, ledgerValue: unknown) {
  const currentStep = step('step-1', 'journey-1', '契约测试步骤');
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/brain/golden-paths') return response({ golden_paths: [gpValue] });
    if (url.includes('/journey_steps?')) return response([currentStep]);
    if (url.includes('/step-1/ledger')) return response(ledgerValue);
    return response({ error: url }, false, 404);
  }) as typeof fetch;
}

describe('WarRoomGoldenPathPage atomic snapshots', () => {
  beforeEach(() => { routeParams.gpId = 'gp-1'; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('does not let a delayed old refresh overwrite a newer route snapshot', async () => {
    const oldGp = gp('gp-1', '旧 GP', 'journey-old');
    const newGp = gp('gp-2', '新 GP', 'journey-new');
    const oldStep = step('step-old', 'journey-old', '旧步骤');
    const newStep = step('step-new', 'journey-new', '新步骤');
    const delayed = deferred<Response>();
    let gpCalls = 0;
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/brain/golden-paths') {
        gpCalls += 1;
        return gpCalls === 1 ? response({ golden_paths: [oldGp] })
          : gpCalls === 2 ? delayed.promise : response({ golden_paths: [newGp] });
      }
      if (url.includes('journey_id=journey-old')) return response([oldStep]);
      if (url.includes('journey_id=journey-new')) return response([newStep]);
      if (url.includes('/step-old/ledger')) return response(ledger(oldStep, '旧格子'));
      if (url.includes('/step-new/ledger')) return response(ledger(newStep, '新格子'));
      return response({}, false, 404);
    }) as typeof fetch;
    const view = render(<WarRoomGoldenPathPage />);
    expect(await screen.findByText('旧格子')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新 GP 与断言账本' }));
    routeParams.gpId = 'gp-2';
    view.rerender(<WarRoomGoldenPathPage />);
    expect(await screen.findByText('新格子')).toBeInTheDocument();
    await act(async () => {
      delayed.resolve(responseObject({ golden_paths: [oldGp] }));
      await Promise.resolve();
    });
    expect(screen.getByTestId('gp-title')).toHaveTextContent('新 GP');
    expect(screen.queryByText('旧格子')).not.toBeInTheDocument();
  });

  it('commits GP metadata and ledgers only as one completed snapshot', async () => {
    const oldGp = gp('gp-1', '旧标题', 'journey-old');
    const newGp = gp('gp-1', '新标题', 'journey-new');
    const oldStep = step('step-old', 'journey-old', '旧步骤');
    const newStep = step('step-new', 'journey-new', '新步骤');
    const delayed = deferred<Response>();
    let refreshing = false;
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/brain/golden-paths') return response({ golden_paths: [refreshing ? newGp : oldGp] });
      if (url.includes('journey_id=journey-old')) return response([oldStep]);
      if (url.includes('journey_id=journey-new')) return response([newStep]);
      if (url.includes('/step-old/ledger')) return response(ledger(oldStep, '旧快照格子'));
      if (url.includes('/step-new/ledger')) return delayed.promise;
      return response({}, false, 404);
    }) as typeof fetch;
    render(<WarRoomGoldenPathPage />);
    expect(await screen.findByText('旧快照格子')).toBeInTheDocument();
    refreshing = true;
    fireEvent.click(screen.getByRole('button', { name: '刷新 GP 与断言账本' }));
    await waitFor(() => expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls
      .some(([url]) => String(url).includes('/step-new/ledger'))).toBe(true));
    expect(screen.getByTestId('gp-title')).toHaveTextContent('旧标题');
    expect(screen.getByText('旧快照格子')).toBeInTheDocument();
    await act(async () => delayed.resolve(responseObject(ledger(newStep, '新快照格子'))));
    expect(await screen.findByText('新快照格子')).toBeInTheDocument();
    expect(screen.getByTestId('gp-title')).toHaveTextContent('新标题');
    expect(screen.queryByText('旧快照格子')).not.toBeInTheDocument();
  });

  const malformedLedgers: Array<[string, (value: Ledger) => unknown]> = [
    ['missing coverage', ({ coverage: _coverage, ...rest }) => rest],
    ['missing verification', (value) => mutateCell(value, ({ verification: _verification, ...cell }) => cell)],
    ['invalid verification state', (value) => mutateCell(value, (cell) => ({
      ...cell, verification: { ...cell.verification, state: 'unknown_state' },
    }))],
    ['invalid step promise', (value) => ({ ...value, step: { ...value.step, promise: 42 } })],
    ['ledger step mismatch', (value) => ({ ...value, step: { ...value.step, id: 'other', step_number: 2 } })],
    ['cell kind mismatch', (value) => mutateCell(value, (cell) => ({ ...cell, cell_kind: 'element' }))],
    ['verified/state contradiction', (value) => mutateCell(value, (cell) => ({
      ...cell, verification: { ...cell.verification, state: 'failed', verified: true },
    }))],
    ['invalid coverage', (value) => ({ ...value, coverage: { ...value.coverage, eligible: -1, percent: 101 } })],
  ];

  it.each(malformedLedgers)('fails closed for malformed ledger: %s', async (_name, mutate) => {
    const currentGp = gp('gp-1', '契约测试 GP', 'journey-1');
    const currentStep = step('step-1', 'journey-1', '契约测试步骤');
    installContractFetch(currentGp, mutate(ledger(currentStep, '不应渲染的格子')));
    render(<WarRoomGoldenPathPage />);
    expect(await screen.findByText('账本数据不可用')).toBeInTheDocument();
    expect(screen.queryByText('不应渲染的格子')).not.toBeInTheDocument();
    expect(screen.queryByText('不可执行断言')).not.toBeInTheDocument();
  });

  it.each(['status', 'one_liner', 'description'] as const)(
    'fails closed when GP.%s is not a nullable string',
    async (field) => {
      const malformedGp = { ...gp('gp-1', '畸形 GP', 'journey-1'), [field]: { unsafe: true } };
      installContractFetch(malformedGp, {});
      render(<WarRoomGoldenPathPage />);
      expect(await screen.findByText('GP 数据不可用')).toBeInTheDocument();
      expect(screen.queryByTestId('gp-title')).not.toBeInTheDocument();
    },
  );

  it('aborts the active load when the page unmounts', async () => {
    const pending = deferred<Response>();
    let signal: AbortSignal | undefined;
    global.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal || undefined;
      return pending.promise;
    }) as typeof fetch;
    const view = render(<WarRoomGoldenPathPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(true);
  });
});
