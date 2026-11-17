import {
  PLIST_DUMP_CMD, OPENCLAW_CONFIG_CMD, OPENCLAW_CRON_CMD, GHA_CRON_CMD,
  CRONTAB_CMD_MMV, CRONTAB_CMD_USVPS,
} from '../../ops-collector.js';

export const NOW = 1794272400000;
export const values = new Map([
  ['launchctl list', 'PID\tStatus\tLabel\n-\t0\tcom.cecelia.fixture'],
  ['readlink /etc/localtime', '/var/db/timezone/zoneinfo/UTC'],
  [PLIST_DUMP_CMD, '== /fixture/a.plist\n{"Label":"com.cecelia.fixture","StartInterval":300}'],
  [OPENCLAW_CONFIG_CMD, JSON.stringify({ agents: { entries: { fixture: { skills: [] } } } })],
  [OPENCLAW_CRON_CMD, JSON.stringify({ jobs: [{ id: 'fixture', name: 'fixture', enabled: true, schedule: { kind: 'every', everyMs: 300000 } }] })],
  [GHA_CRON_CMD, ''],
  [CRONTAB_CMD_MMV, 'aad001\n*/5 * * * * /fixture/run.sh # fixture'],
  [CRONTAB_CMD_USVPS, 'ubuntu-s-fixture\n*/5 * * * * /fixture/run.sh # fixture'],
]);

export function fakePool() {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return { rows: [] };
    },
  };
}

export function commandValue(command) {
  if (!values.has(command)) throw Error('unexpected fixture command');
  return values.get(command);
}
