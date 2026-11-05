import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const effects = vi.hoisted(() => ({ query: vi.fn(), forbidden: vi.fn(() => { throw Error('real external action forbidden'); }) }));
vi.mock('../db.js', () => ({ default: { query: effects.query } }));
vi.mock('../notifier.js', () => ({ sendFeishu: effects.forbidden }));
vi.mock('child_process', () => ({ execFileSync: effects.forbidden, execSync: effects.forbidden, exec: effects.forbidden }));
vi.mock('node:child_process', () => ({ execFileSync: effects.forbidden, execSync: effects.forbidden, exec: effects.forbidden }));
vi.mock('fs', () => ({ readFileSync: effects.forbidden, writeFileSync: effects.forbidden, appendFileSync: effects.forbidden, existsSync: effects.forbidden, readdirSync: effects.forbidden }));
vi.mock('node:fs', () => ({ readFileSync: effects.forbidden, writeFileSync: effects.forbidden, appendFileSync: effects.forbidden, existsSync: effects.forbidden, readdirSync: effects.forbidden }));
let clock, guards, alerting, persisted;
const base = 2_000_000_000_000;
const stalled = Array(3).fill('[owned] 发送失败').join('\n');
beforeEach(async () => {
  vi.resetModules(); effects.query.mockReset(); effects.forbidden.mockClear(); persisted = [];
  effects.query.mockImplementation(async (sql, params) => {
    expect(params[0]).toBe('alerting_buffers');
    if (sql.startsWith('SELECT value_json')) return { rows: [] };
    expect(sql).toMatch(/INSERT INTO working_memory/);
    persisted.push(JSON.parse(params[1])); return { rows: [] };
  });
  clock = base;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  vi.stubGlobal('fetch', effects.forbidden);
  guards = await import('../openclaw-guards.js');
  alerting = await import('../alerting.js');
});
afterEach(() => { expect(effects.forbidden).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function options(mode, tail) {
  const cfg = { agents: { defaults: { model: { primary: 'openai/gpt-5.6-terra' } } }, plugins: { codex: { config: { appServer: { command: '/usr/bin/ssh', args: ['codex-runner'] } } } } };
  return {
    env: { OPENCLAW_GUARD_MODE: mode }, nowMs: clock, inContainer: false, raiseFn: alerting.raise,
    remoteExecFn: async command => { expect(command).toContain('tail -12 ~/outreach.log'); return tail; },
    probeFn: () => false,
    io: {
      exec: (command, args) => {
        if (command === 'docker' && args[0] === 'stats') return '200MiB / 2GiB';
        if (command === 'docker' && args[0] === 'top') return 'PID COMMAND';
        expect(command).toBe('ssh'); expect(args.at(-1)).toContain('tail -12 ~/outreach.log'); return tail;
      },
      read: path => {
        if (path === '/opt/openclaw/state/clawdbot.json') return JSON.stringify(cfg);
        expect(['/opt/openclaw/workspaces-root/clawd/AGENTS.md', '/opt/openclaw/state/ssh-router.conf']).toContain(path); return '';
      },
      listDirs: () => [], now: () => new Date(clock), log: () => {},
      write: effects.forbidden, append: effects.forbidden,
    },
  };
}
it.each(['remote', 'local'])('%s真实caller进入P1缓冲，180分钟冷却后再次入缓冲', async mode => {
  const first = await guards.runOpenclawGuards(null, options(mode, stalled));
  expect(first.outreach).toMatchObject({ verdict: 'stalled', stalledTicks: 3 });
  expect(alerting.getStatus().p1_pending).toBe(1);
  expect(persisted).toHaveLength(1);
  expect(persisted[0].p1).toEqual([expect.objectContaining({ eventType: 'outreach_stalled', message: expect.stringContaining('3 轮') })]);
  for (const minutes of [5, 175]) {
    clock = base + minutes * 60_000;
    await guards.runOpenclawGuards(null, options(mode, stalled));
    expect(alerting.getStatus().p1_pending).toBe(1);
    expect(persisted).toHaveLength(1);
  }
  clock = base + 180 * 60_000;
  await guards.runOpenclawGuards(null, options(mode, stalled));
  expect(alerting.getStatus().p1_pending).toBe(2);
  expect(persisted).toHaveLength(2);
  expect(persisted[1].p1).toHaveLength(2);
  expect(effects.query).toHaveBeenCalledTimes(3);
});
it.each(['remote', 'local'])('%s正常/无现场证据不创建告警', async mode => {
  for (const [index, tail] of ['[owned] 无待触达单', '[owned] 已发送', ''].entries()) {
    clock = base + index * 5 * 60_000;
    const out = await guards.runOpenclawGuards(null, options(mode, tail));
    expect(out.outreach.verdict).toBe(['idle', 'healthy', 'unknown'][index]);
    expect(alerting.getStatus().p1_pending).toBe(0);
  }
  expect(effects.query).not.toHaveBeenCalled();
});
