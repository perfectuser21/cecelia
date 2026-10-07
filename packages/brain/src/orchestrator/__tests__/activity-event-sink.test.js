import { test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createActivityEventSink, runActivityContractWithEventStore } from '../activity-event-sink.js';

test.each([
  [{ runId: 'invalid' }, 'activity_run_id_invalid'],
  [{ sourceId: 'invalid' }, 'activity_source_id_invalid'],
  [{ runTag: 'run with spaces' }, 'activity_run_tag_invalid'],
])('非法事件身份在获取数据库连接前拒绝：%s', async (override, reason) => {
  let connects = 0;
  const pool = { connect: async () => { connects++; throw Error('不允许进入数据库'); } };
  await expect(createActivityEventSink({ pool, runId: randomUUID(), sourceId: randomUUID(),
    runTag: 'valid-run', ...override })).rejects.toThrow(reason);
  expect(connects).toBe(0);
});

test.each([
  { input: { run_tag: 'safe-run', password: 'fixture-only' }, contract: {} },
  { input: { run_tag: 'safe-run' }, contract: { token: 'fixture-only' } },
])('输入或契约携带凭据时，在连接事件账前拒绝', async ({ input, contract }) => {
  let connects = 0;
  const pool = { connect: async () => { connects++; throw Error('不允许进入数据库'); } };
  await expect(runActivityContractWithEventStore(contract, input,
    { pool, runId: randomUUID(), sourceId: randomUUID() })).rejects.toThrow('secret');
  expect(connects).toBe(0);
});
