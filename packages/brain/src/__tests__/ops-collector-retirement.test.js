import { beforeEach, expect, it } from 'vitest';
import { __resetOpsCollectorForTest, runOpsCollector } from '../ops-collector.js';
import { NOW, commandValue, fakePool } from './fixtures/ops-collector-command-values.mjs';

beforeEach(() => __resetOpsCollectorForTest());

it('退休后真实采集只运行现役来源，保留历史且不再写 n8n 快照或心跳', async () => {
  const pool = fakePool();
  const commands = [];
  const result = await runOpsCollector(pool, {
    now: NOW, inContainer: false,
    exec: async command => { commands.push(command); return commandValue(command); },
  });
  expect(commands.filter(command => /n8n|execution_entity|execution_data/.test(command))).toEqual([]);
  expect(Object.keys(result.results).sort()).toEqual([
    'launchd', 'openclaw', 'openclaw_crons', 'gha', 'crontab_mmv', 'crontab_usvps',
  ].sort());
  expect(Object.values(result.results).every(source => source.ok)).toBe(true);
  expect(pool.queries.filter(({ sql, params }) => /n8n|ops_runs|ops_workflows/.test(sql)
    || params?.some(value => value === 'n8n' || value === 'n8n-runs'))).toEqual([]);
  expect(pool.queries.some(({ sql }) => /DELETE|TRUNCATE/.test(sql))).toBe(false);
  expect(pool.queries.some(({ sql }) => sql.includes('INSERT INTO ops_agents'))).toBe(true);
  expect(pool.queries.some(({ sql }) => sql.includes('INSERT INTO ops_schedule_entries'))).toBe(true);
});
