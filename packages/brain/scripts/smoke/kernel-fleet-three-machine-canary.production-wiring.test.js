/* global AbortSignal */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  MACHINE_IDS,
  createLiveDispatch,
} from './kernel-fleet-three-machine-canary.mjs';

const pool = vi.hoisted(() => ({
  query: vi.fn(),
  end: vi.fn(),
}));

vi.mock('../../src/db.js', () => ({ default: pool }));

const RUN_ID = '11111111-1111-4111-8111-111111111111';

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

describe('createLiveDispatch production probe wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(MACHINE_IDS)(
    'gives the real buildRealDeps probe the canonical %s identity',
    async (targetMachine) => {
      pool.query.mockImplementation(async (sql, params) => {
        if (/INSERT INTO initiative_runs/.test(sql)) {
          return { rows: [{ id: RUN_ID }], rowCount: 1 };
        }
        if (/SELECT provider, account_id, requested_machine_id/.test(sql)) {
          return { rows: [] };
        }
        if (/INSERT INTO harness_attempts/.test(sql)) {
          throw new Error(`probe_selected_machine:${params[7]}`);
        }
        throw new Error(`unexpected query: ${sql}`);
      });
      const fetchFn = vi.fn(async (url) => {
        if (url === 'http://localhost:5221/api/brain/health') {
          return { ok: true, status: 200 };
        }
        if (url.endsWith('/api/brain/capacity-budget')) {
          return jsonResponse({
            fleet: MACHINE_IDS.map((machine) => ({
              id: machine,
              registered: true,
              online: true,
              effective_slots: 1,
              physical_capacity: 1,
              pressure: 0,
            })),
          });
        }
        if (url.endsWith('/api/brain/dispatch/llm-capacity')) {
          return jsonResponse({
            vendors: {
              codex: {
                accounts: [
                  { name: 'team1', available: true, source: 'test' },
                  { name: 'team2', available: true, source: 'test' },
                  { name: 'team5', available: true, source: 'test' },
                ],
              },
            },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      });
      vi.stubGlobal('fetch', fetchFn);
      const dispatch = await createLiveDispatch({
        runId: RUN_ID,
        brainUrl: 'http://localhost:5221',
        env: { CECELIA_MACHINE_ID: 'us-mac-m4' },
        fetchFn,
      });

      try {
        await expect(dispatch({
          machine: targetMachine,
          attemptNumber: 1,
        })).rejects.toThrow(`probe_selected_machine:${targetMachine}`);
      } finally {
        await dispatch.close();
      }

      expect(fetchFn).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/brain\/capacity-budget$/),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    },
  );
});
