import { test } from 'vitest';
import assert from 'node:assert/strict';
import { runStandaloneWorkerOnce } from './worker.mjs';

const job = { machine_id: 'mac-studio', task_id: 'task-101', run_id: 'run-101' };
const receipt = { task_id: job.task_id, run_id: job.run_id, status: 'completed', summary: '已读回', evidence: ['fixture:101'] };

test('宿主领取后只执行一次，回执中断时下一轮只重送同一份回执', async () => {
  let saved, executions = 0;
  const actions = [];
  const options = {
    machineId: job.machine_id,
    request: async (action, body) => {
      actions.push(action);
      if (action === 'claim') return { job };
      assert.deepEqual(body.receipt, receipt);
      if (actions.length === 2) throw Error('network disconnected');
      return { status: 'completed' };
    },
    provider: async incoming => {
      assert.deepEqual(incoming, job);
      return {
        startHost: async () => ({
          connectionPath: 'fixture',
          close: async () => ({ task_id: job.task_id, run_id: job.run_id, local_released: true, central_released: true, native_return_unknown: false }),
        }),
        runAgent: async () => { executions++; },
        verifyBusiness: async () => ({ summary: receipt.summary, evidence: receipt.evidence }),
      };
    },
    receipts: {
      pending: async () => saved,
      save: async result => { saved = result; },
      sent: async () => { saved = undefined; },
    },
  };
  await assert.rejects(runStandaloneWorkerOnce(options), /network disconnected/);
  assert.deepEqual(await runStandaloneWorkerOnce(options), { status: 'reconciled' });
  assert.equal(executions, 1);
  assert.deepEqual(actions, ['claim', 'finish', 'finish']);
});

test('宿主无法证明启动结果时回写需复核', async () => {
  let receipt;
  const result = await runStandaloneWorkerOnce({
    machineId: job.machine_id,
    request: async action => action === 'claim' ? { job } : { status: 'blocked' },
    provider: async () => { throw Error('host unresolved'); },
    receipts: {
      pending: async () => null,
      save: async result => { receipt = result; },
      sent: async () => {},
    },
  });
  assert.deepEqual(result, { status: 'needs_review' });
  assert.equal(receipt.reason, 'standalone_start_unconfirmed');
});
