/**
 * Regression: cascade-writeback 回写 assertion_ref
 * 决策 df1ccf5a §③: evaluator PASS 后 PATCH 必须同时携带 assertion_ref
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeCascadeCellStatuses } from '../lib/cascade-writeback.js';

describe('cascade-writeback assertion_ref 回填', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('PASS 且有 assertion_ref 时，PATCH body 包含 assertion_ref', async () => {
    const fetched = [];
    vi.stubGlobal('fetch', async (url, opts) => {
      fetched.push({ url, body: JSON.parse(opts.body) });
      return { ok: true };
    });

    await writeCascadeCellStatuses([
      { link_id: 'link-001', ran: true, result: 'pass', assertion_ref: 'tests/foo.test.js' },
    ]);

    expect(fetched).toHaveLength(1);
    expect(fetched[0].body.cell_status).toBe('green');
    expect(fetched[0].body.assertion_ref).toBe('tests/foo.test.js');
  });

  it('PASS 但无 assertion_ref 时，PATCH body 不带 assertion_ref 字段', async () => {
    const fetched = [];
    vi.stubGlobal('fetch', async (url, opts) => {
      fetched.push({ url, body: JSON.parse(opts.body) });
      return { ok: true };
    });

    await writeCascadeCellStatuses([
      { link_id: 'link-002', ran: true, result: 'pass' },
    ]);

    expect(fetched).toHaveLength(1);
    expect(fetched[0].body.cell_status).toBe('green');
    expect('assertion_ref' in fetched[0].body).toBe(false);
  });

  it('未跑（ran=false）或未 pass 的项不回写', async () => {
    const fetched = [];
    vi.stubGlobal('fetch', async (url, opts) => {
      fetched.push({ url, body: JSON.parse(opts.body) });
      return { ok: true };
    });

    const { written, skipped } = await writeCascadeCellStatuses([
      { link_id: 'link-003', ran: false, result: 'pass', assertion_ref: 'tests/bar.test.js' },
      { link_id: 'link-004', ran: true, result: 'fail', assertion_ref: 'tests/baz.test.js' },
    ]);

    expect(fetched).toHaveLength(0);
    expect(written).toBe(0);
    expect(skipped).toBe(2);
  });
});
