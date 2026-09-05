import { describe, it, expect, beforeEach } from 'vitest';
import { runOpsCollector, __resetOpsCollectorForTest, HK_OPENCLAW_CMD } from '../ops-collector.js';

function fakePool() {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => { queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return { rows: [] }; },
  };
}
const LIST_OK = 'PID\tStatus\tLabel\n-\t0\tcom.cecelia.backup-db';
const PLIST_OK = '== /L/a.plist\n{"Label":"com.cecelia.backup-db","StartInterval":300}';
const CLAW_OK = JSON.stringify({ agents: { entries: { main: {}, dev: {} } } });

function fakeExec(map) {
  const calls = [];
  const fn = (cmd) => {
    calls.push(cmd);
    for (const [key, val] of Object.entries(map)) {
      if (cmd.includes(key)) {
        if (val instanceof Error) throw val;
        return val;
      }
    }
    return '';
  };
  fn.calls = calls;
  return fn;
}

beforeEach(() => __resetOpsCollectorForTest());

describe('runOpsCollector', () => {
  it('OpenClaw 命令写死容器内路径（禁 find/通配）', () => {
    expect(HK_OPENCLAW_CMD).toContain('docker exec openclaw-gateway cat /root/.openclaw/clawdbot.json');
    expect(HK_OPENCLAW_CMD).toContain('BatchMode=yes');
    expect(HK_OPENCLAW_CMD).toContain('ConnectTimeout=6');
    expect(HK_OPENCLAW_CMD).not.toContain('find');
  });

  it('全部成功：三路各写快照+心跳 ok', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': LIST_OK, 'plutil': PLIST_OK, 'clawdbot.json': CLAW_OK, 'workflows': '', 'readlink': '/var/db/timezone/zoneinfo/America/Los_Angeles' });
    const r = await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });
    expect(r.results.launchd.ok).toBe(true);
    expect(r.results.openclaw.ok).toBe(true);
    const hb = pool.queries.filter((q) => q.sql.includes('ops_source_heartbeats'));
    expect(hb.some((q) => q.params?.includes('openclaw'))).toBe(true);
    expect(pool.queries.some((q) => q.sql.includes('ON CONFLICT (source, host_alias, name)'))).toBe(true);
  });

  it('ssh hk 腿断：openclaw 心跳 unreachable+last_error 双写，launchd 照常 ok（per-source 隔离）', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': LIST_OK, 'plutil': PLIST_OK, 'clawdbot.json': new Error('ssh: connect timeout'), 'readlink': 'zoneinfo/America/Los_Angeles' });
    const r = await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });
    expect(r.results.launchd.ok).toBe(true);
    expect(r.results.openclaw.ok).toBe(false);
    const hb = pool.queries.find((q) => q.sql.includes('ops_source_heartbeats') && q.params?.includes('unreachable'));
    expect(hb).toBeTruthy();
    expect(hb.params.join('|')).toContain('connect timeout');
  });

  it('launchctl 解析出 0 行 = parse_error 不是空快照', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': 'PID\tStatus\tLabel\n', 'clawdbot.json': CLAW_OK });
    const r = await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });
    expect(r.results.launchd.ok).toBe(false);
    expect(pool.queries.some((q) => q.params?.includes('parse_error'))).toBe(true);
    expect(pool.queries.some((q) => q.sql.includes('INSERT INTO ops_agents') && q.params?.includes('launchd'))).toBe(false);
  });

  it('clawdbot JSON 半写入：整份丢弃走 parse_error', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': LIST_OK, 'plutil': PLIST_OK, 'clawdbot.json': '{"agents": {"entr', 'readlink': 'zoneinfo/America/Los_Angeles' });
    const r = await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });
    expect(r.results.openclaw.ok).toBe(false);
    expect(pool.queries.some((q) => q.sql.includes('INSERT INTO ops_agents') && q.params?.includes('openclaw'))).toBe(false);
  });

  it('模块自 gate：间隔内二次调用 skipped', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': LIST_OK, 'plutil': PLIST_OK, 'clawdbot.json': CLAW_OK, 'readlink': 'zoneinfo/America/Los_Angeles' });
    await runOpsCollector(pool, { exec, inContainer: false, now: 1000000000000 });
    const r2 = await runOpsCollector(pool, { exec, inContainer: false, now: 1000000000000 + 1000 });
    expect(r2.skipped).toBe(true);
  });

  it('快照缺席的 agent 标 offline 不删行', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': LIST_OK, 'plutil': PLIST_OK, 'clawdbot.json': CLAW_OK, 'readlink': 'zoneinfo/America/Los_Angeles' });
    await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });
    const off = pool.queries.find((q) => q.sql.includes("SET status='offline'"));
    expect(off).toBeTruthy();
    expect(off.sql).not.toContain('DELETE');
  });
});
