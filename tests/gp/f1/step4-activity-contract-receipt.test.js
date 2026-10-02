// GP-Anchor: f1/step4 — 交付有回执；真实活动边界，意图到账后才启动，产物读回。
import { test, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runActivityContract } from '../../../packages/brain/src/orchestrator/activity-runtime.js';
import { parseActivityContract } from '../../../packages/brain/src/orchestrator/activity-contract.js';

test('F1 step4：真实活动启动前先发意图，完成回执与活动产物读回一致', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f1-step4-activity-receipt-'));
  const trace = join(dir, 'trace.jsonl'), events = [];
  const cwd = dirname(fileURLToPath(new URL('../../../packages/brain/src/orchestrator/__tests__/fixtures/activity-runtime/activity.mjs', import.meta.url)));
  const plan = parseActivityContract({ workflow: 'receipt-edge', activities: [{ key: 'delivery', order: 1,
    budget: { max_duration_s: 5, heartbeat_s: 1 },
    failure: { empty_ok: [], retryable: [], fatal: ['invalid'], needs_human: { cases: [] } },
    runtime: { protocol: 'json-stdio-v1', phase: 'batch_end', entry: 'activity.mjs', argv: ['deliver'] },
  }] });
  try {
    const fragments = [{ id: 'explicit-product', owner: 'same-run' }];
    const result = await runActivityContract(plan, { run_tag: 'receipt-run', trace, fragments }, { cwd,
      onEvent: async (event, receipt) => {
        if (event.event_type === 'ACTIVITY_STARTED') {
          await expect(readFile(trace, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
        }
        if (event.event_type === 'ACTIVITY_FINISHED') {
          const actualCall = JSON.parse((await readFile(trace, 'utf8')).trim());
          expect(actualCall.input.run_tag).toBe(event.run_tag);
          expect(receipt.outputs.delivered).toEqual(actualCall.input.fragments);
          expect(receipt.activities[0].attempts[0].transport.exit_code).toBe(0);
        }
        events.push({ event, receipt });
      },
    });
    expect(result.status).toBe('completed');
    expect(result.outputs.delivered).toEqual(fragments);
    expect(result.metrics.delivery.delivered).toBe(1);
    expect(events.map(row => row.event.event_type)).toEqual(['WF_RUN_STARTED', 'ACTIVITY_STARTED', 'ACTIVITY_FINISHED', 'WF_RUN_FINALIZED']);
    expect(events.map(row => row.event.cursor)).toEqual([1, 2, 3, 4]);
    expect(events.at(-1).receipt).toEqual(result);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
