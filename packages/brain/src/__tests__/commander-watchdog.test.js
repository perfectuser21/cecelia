/**
 * commander-watchdog.test.js — Commander 看门狗 + 心跳 + Bark 阈值（任务 17ea4536，决策 3c98fb36）。
 *
 * 09-30 事故：escort 02:52 被移除后 5 小时无人陪跑。钉死：
 *  - 心跳按 TAG / 账本 run_id / serial 三级定位在途 run，写 payload.commander_heartbeat_at（+tag/host/escort_id）
 *  - 看门狗：在途 run 心跳缺失/超 15min → ssh MMV 重新登记同名 escort（接班消息：只读账本与日志接上，不重发起），
 *    新 id 回写 payload，task_events commander_relaunched；同一 run 接班 ≥3 次 → Bark 一次并停止再拉
 *  - 趋势：同一 wf 连续 2 个自然日零线索 → 每日一次 Bark；一台 serial 24h 无 completed → Bark
 * 外部命令（ssh / Bark）全部桩成可断言的 spy，绝不真发。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { sshTargetFor, resolvePrimaryWorkerId } from '../machine-registry.js';
import {
  recordCommanderHeartbeat,
  runCommanderWatchdog,
  runWorkflowTrendBark,
  buildEscortRelaunchRemote,
  DEFAULT_HEARTBEAT_STALE_MS,
  MAX_RELAUNCH,
} from '../commander-watchdog.js';

const GATEWAY = sshTargetFor(resolvePrimaryWorkerId());

it('接班消息先经网关 SSH 读 SOP；心跳 JSON 经 shell 原样到达 curl', async () => {
  const remote = buildEscortRelaunchRemote({ host: 'xian-m4', tag: 'cmd10020630', serial: 'S1', profile: 'legacy', taskId: 'run1', relaunchCount: 1 });
  // 实际 shell 解码 cron --message，不靠正则假设引号正确。
  const args = JSON.parse(execFileSync('/bin/sh', ['-c', `openclaw(){ python3 -c 'import sys,json;print(json.dumps(sys.argv[1:]))' "$@"; }; ${remote}`], { encoding: 'utf8' }));
  const message = args[args.indexOf('--message') + 1];
  expect(message).toContain(`ssh -o BatchMode=yes -o ConnectTimeout=10 ${GATEWAY}`);
  const heartbeat = message.match(/每轮末尾必须发心跳: (.*)$/)?.[1];
  expect(heartbeat).toBeTruthy();
  const output = execFileSync('/bin/sh', ['-c', `
    curl(){ python3 -c 'import sys,json;print(json.dumps(sys.argv[1:]))' "$@"; }
    ssh(){ while [ "$1" = "-o" ]; do shift 2; done; shift; eval "$1"; }
    ${heartbeat}
  `], { encoding: 'utf8' });
  const curlArgs = JSON.parse(output);
  expect(JSON.parse(curlArgs[curlArgs.indexOf('-d') + 1])).toMatchObject({ tag: 'cmd10020630', host: 'xian-m4', serial: 'S1' });
});

function makePool(handlers) {
  const calls = [];
  const query = vi.fn(async (sql, params) => {
    const text = String(sql);
    calls.push({ sql: text, params });
    for (const [re, fn] of handlers) {
      if (re.test(text)) return typeof fn === 'function' ? fn(text, params) : fn;
    }
    return { rows: [] };
  });
  return { query, calls };
}

const RUN = {
  id: 'task-run-1', task_type: 'device_job', title: '获客采收·AI训练师 · 4137 · 02:00 · abc',
  payload: { serial: 'ANGYVB4402004137', source: 'cron', tag: 'cmd09300200', host: 'xian-m4', profile: 'legacy', escort_id: 'old-escort-id-0000' },
};

describe('recordCommanderHeartbeat', () => {
  beforeEach(() => vi.clearAllMocks());

  it('按 payload.tag 命中在途 run → 写 commander_heartbeat_at 并把 escort_id/host/serial 并进 payload', async () => {
    const pool = makePool([
      [/payload->>'tag' = \$1/, { rows: [{ id: 'task-run-1', payload: RUN.payload }] }],
      [/UPDATE tasks/, (sql, params) => ({ rows: [{ id: params[0] }], rowCount: 1 })],
    ]);
    const out = await recordCommanderHeartbeat(pool, { tag: 'cmd09300200', host: 'xian-m4', serial: 'ANGYVB4402004137', escort_id: 'esc-new-1', escort_name: 'escort-xian-m4-cmd09300200' }, { now: Date.parse('2026-09-30T03:00:00Z') });
    expect(out).toMatchObject({ matched: true, task_id: 'task-run-1', via: 'tag' });
    const upd = pool.calls.find((c) => /UPDATE tasks/.test(c.sql));
    expect(upd.sql).toMatch(/status = 'in_progress'/);
    const merged = JSON.parse(upd.params[1]);
    expect(merged).toMatchObject({ commander_heartbeat_at: '2026-09-30T03:00:00.000Z', escort_id: 'esc-new-1', host: 'xian-m4', tag: 'cmd09300200', escort_name: 'escort-xian-m4-cmd09300200' });
  });

  it('tag 没命中 → 按账本 run_id（task_runs LIKE %-<TAG>__%）→ 再按 serial 唯一在途镜像单', async () => {
    const pool = makePool([
      [/payload->>'tag' = \$1/, { rows: [] }],
      [/JOIN task_runs/, (sql, params) => { expect(params[0]).toBe('%-cmd09300200\\_\\_%'); return { rows: [] }; }],
      [/payload->>'serial' = \$1/, { rows: [{ id: 'task-by-serial', payload: { serial: 'ANGYVB4402004137', source: 'cron' } }] }],
      [/UPDATE tasks/, (sql, params) => ({ rows: [{ id: params[0] }], rowCount: 1 })],
    ]);
    const out = await recordCommanderHeartbeat(pool, { tag: 'cmd09300200', serial: 'ANGYVB4402004137', host: 'xian-m4' });
    expect(out).toMatchObject({ matched: true, task_id: 'task-by-serial', via: 'serial' });
  });

  it('kind=launch（wf-launch 起跑时 Brain 单还没建）→ 存 working_memory commander_launch:<TAG>，不报错', async () => {
    const pool = makePool([
      [/payload->>'tag' = \$1/, { rows: [] }],
      [/INSERT INTO working_memory/, { rows: [] }],
    ]);
    const out = await recordCommanderHeartbeat(pool, { kind: 'launch', tag: 'cmd09300200', host: 'xian-m4', serial: 'ANGYVB4402004137', escort_id: 'esc-launch-1' });
    expect(out).toMatchObject({ matched: false, stored: 'launch' });
    const wm = pool.calls.find((c) => /INSERT INTO working_memory/.test(c.sql));
    expect(wm.params[0]).toBe('commander_launch:cmd09300200');
    expect(JSON.parse(wm.params[1])).toMatchObject({ escort_id: 'esc-launch-1', host: 'xian-m4' });
  });

  it('tag 非法 / 缺 tag 与 serial → 拒绝', async () => {
    const pool = makePool([]);
    await expect(recordCommanderHeartbeat(pool, { tag: 'bad tag; rm' })).rejects.toThrow(/tag/);
    await expect(recordCommanderHeartbeat(pool, {})).rejects.toThrow(/tag|serial/);
  });
});

it('已声明能力的接班必须先读相同专属skill，缺能力不能自选', () => {
  const remote = buildEscortRelaunchRemote({ host: 'xian-m4', tag: 'cmdfixture', cap: 'keyword_acquisition', taskId: 'run1', relaunchCount: 1 });
  const args = JSON.parse(execFileSync('/bin/sh', ['-c', `openclaw(){ python3 -c 'import sys,json;print(json.dumps(sys.argv[1:]))' "$@"; }; ${remote}`], { encoding: 'utf8' }));
  expect(args[args.indexOf('--message') + 1]).toContain('wf-keyword_acquisition/SKILL.md');
  expect(args[args.indexOf('--message') + 1]).toContain('专属skill');
  const legacy = buildEscortRelaunchRemote({ host: 'xian-m4', tag: 'cmdfixture', taskId: 'run1', relaunchCount: 1 });
  expect(legacy).toContain('能力缺失');
});

it('自启动真实心跳携带cap后落账，接班沿同cap加载专属skill', async () => {
  let patch;
  const pool = { query: async (sql, params) => {
    if (sql.includes('UPDATE tasks')) { patch = JSON.parse(params[1]); return { rowCount: 1 }; }
    if (sql.includes("payload->>'tag'")) return { rows: [{ id: 'run1', payload: { escort_id: 'id1' } }] };
    return { rows: [] };
  }};
  const result = await recordCommanderHeartbeat(pool, { tag: 'cmdfixture', host: 'xian-m4',
    cap: 'benchmark_link_acquisition', serial: 'S1', profile: 'legacy' });
  expect(result.matched).toBe(true); expect(patch.cap).toBe('benchmark_link_acquisition');
  expect(buildEscortRelaunchRemote({ ...patch, taskId: 'run1', relaunchCount: 1 })).toContain('wf-benchmark_link_acquisition/SKILL.md');
});

describe('buildEscortRelaunchRemote', () => {
  it('隔离验收可显式指定心跳 API 与关闭对外投递，默认生产行为不变', () => {
    const oldUrl = process.env.COMMANDER_BRAIN_URL;
    const oldDelivery = process.env.COMMANDER_ESCORT_DELIVERY;
    try {
      process.env.COMMANDER_BRAIN_URL = 'http://localhost:5299';
      process.env.COMMANDER_ESCORT_DELIVERY = 'none';
      const remote = buildEscortRelaunchRemote({ host: 'xian-m4', tag: 'cmd10020930', taskId: 'drill', relaunchCount: 1 });
      expect(remote).toContain('--no-deliver');
      expect(remote).not.toContain('--announce');
      expect(remote).toContain('http://localhost:5299/api/brain/commander-heartbeat');
    } finally {
      if (oldUrl === undefined) delete process.env.COMMANDER_BRAIN_URL; else process.env.COMMANDER_BRAIN_URL = oldUrl;
      if (oldDelivery === undefined) delete process.env.COMMANDER_ESCORT_DELIVERY; else process.env.COMMANDER_ESCORT_DELIVERY = oldDelivery;
    }
  });
  it('同名 escort-<host>-<TAG>，消息注明接班只读接上不重发起，带 Brain 单号；远端串单引号安全', () => {
    const remote = buildEscortRelaunchRemote({ host: 'xian-m4', tag: 'cmd09300200', serial: 'ANGYVB4402004137', profile: 'legacy', taskId: 'task-run-1', relaunchCount: 2 });
    expect(remote).toContain("cron add --timeout 90000 --name 'escort-xian-m4-cmd09300200' --agent work-commander");
    expect(remote).toContain("--session 'session:escort-xian-m4-cmd09300200' --every 10m");
    expect(remote).toContain('接班');
    expect(remote).toContain('只读账本与日志接上');
    expect(remote).toContain('不重新发起');
    expect(remote).toContain('Brain单=task-run-1');
    expect(remote).toContain('cmdr-escort.txt');
    // 嵌套 SSH/JSON 需要多层引号；用真实 shell 校验语法，运输内容由上方行为回归读回。
    const parsed = execFileSync('/bin/sh', ['-n', '-c', remote], { encoding: 'utf8' });
    expect(parsed).toBe('');
  });
});

describe('runCommanderWatchdog', () => {
  beforeEach(() => vi.clearAllMocks());

  // 桩按远端命令分流：cron list --json 回 listJobs（默认空表），其余回 reply
  function sshStub(reply = '{"id": "esc-relaunched-1111"}', listJobs = []) {
    const seen = [];
    const fn = vi.fn((cmd, args, opts, cb) => {
      const remote = args[args.length - 1];
      seen.push({ target: args[args.length - 2], remote });
      if (/cron list --json/.test(remote)) return cb(null, JSON.stringify({ jobs: listJobs }), '');
      cb(null, reply, '');
    });
    return { fn, seen };
  }

  it('add成功但首轮run失败：保留接班身份，落失败事件，不伪写恢复心跳', async () => {
    const pool = makePool([
      [/FROM tasks[\s\S]*commander_heartbeat_at/, { rows: [RUN] }],
      [/UPDATE tasks/, (sql, params) => ({ rows: [{ id: params[0] }], rowCount: 1 })],
    ]);
    const execFileFn = vi.fn((cmd, args, opts, callback) => {
      const remote = args.at(-1);
      if (remote.includes('cron run')) return callback(new Error('queue unavailable'), '', '');
      callback(null, remote.includes('cron list') ? '{"jobs":[]}' : '{"id":"esc-relaunched-1111"}', '');
    });
    const bark = vi.fn();
    const out = await runCommanderWatchdog(pool, { execFileFn, bark, gateMs: 0 });
    expect(out.relaunched).toBe(1);
    const patch = JSON.parse(pool.calls.find(c => /UPDATE tasks/.test(c.sql)).params[1]);
    expect(patch.escort_id).toBe('esc-relaunched-1111');
    expect(patch.commander_heartbeat_at).toBeUndefined();
    const events = pool.calls.filter(c => /INSERT INTO task_events/.test(c.sql)).map(c => c.params[1]);
    expect(events).toEqual(['commander_relaunched', 'commander_activation_failed']);
    expect(bark).not.toHaveBeenCalled();
  });

  it('心跳过期（判据在 SQL）→ 先 rm 旧 escort 再 add 同名 escort，新 id 回写 payload，计数 +1，task_events commander_relaunched；不 Bark', async () => {
    const pool = makePool([
      [/FROM tasks[\s\S]*commander_heartbeat_at/, (sql, params) => {
        expect(sql).toMatch(/COALESCE\(started_at, due_at, created_at\) < NOW\(\)/);
        expect(sql).toMatch(/commander_heartbeat_at/);
        expect(sql).toMatch(/commander_relaunch_count/);
        expect(params[0]).toBe(DEFAULT_HEARTBEAT_STALE_MS);
        expect(params[1]).toBe(MAX_RELAUNCH);
        return { rows: [RUN] };
      }],
      [/UPDATE tasks/, (sql, params) => ({ rows: [{ id: params[0] }], rowCount: 1 })],
    ]);
    const ssh = sshStub();
    const bark = vi.fn().mockResolvedValue(true);
    const out = await runCommanderWatchdog(pool, { execFileFn: ssh.fn, bark, gateMs: 0, now: Date.parse('2026-09-30T03:10:00Z') });
    expect(out.relaunched).toBe(1);
    expect(ssh.seen).toHaveLength(4);
    expect(ssh.seen[0].target).toBe(GATEWAY);
    expect(ssh.seen[0].remote).toBe('openclaw cron list --json');
    expect(ssh.seen[1].remote).toContain('cron rm old-escort-id-0000');
    expect(ssh.seen[2].remote).toContain("cron add --timeout 90000 --name 'escort-xian-m4-cmd09300200'");
    expect(ssh.seen[3].remote).toBe("openclaw cron run 'esc-relaunched-1111' --timeout 90000");
    const upd = pool.calls.find((c) => /UPDATE tasks/.test(c.sql) && c.params[0] === 'task-run-1');
    const merged = JSON.parse(upd.params[1]);
    expect(merged).toMatchObject({ escort_id: 'esc-relaunched-1111', commander_relaunch_count: 1, commander_relaunched_at: '2026-09-30T03:10:00.000Z' });
    const ev = pool.calls.find((c) => /INSERT INTO task_events/.test(c.sql));
    expect(ev.params[1]).toBe('commander_relaunched');
    expect(bark).not.toHaveBeenCalled();
  });

  it('第 3 次接班 → Bark 一次（含 TAG/机器/单号），payload.commander_bark_at 落下，之后不再拉', async () => {
    const stale = { ...RUN, payload: { ...RUN.payload, commander_relaunch_count: 2 } };
    const pool = makePool([
      [/FROM tasks[\s\S]*commander_heartbeat_at/, { rows: [stale] }],
      [/UPDATE tasks/, (sql, params) => ({ rows: [{ id: params[0] }], rowCount: 1 })],
    ]);
    const ssh = sshStub();
    const bark = vi.fn().mockResolvedValue(true);
    const out = await runCommanderWatchdog(pool, { execFileFn: ssh.fn, bark, gateMs: 0 });
    expect(out.relaunched).toBe(1);
    expect(out.barked).toBe(1);
    expect(bark).toHaveBeenCalledTimes(1);
    expect(bark.mock.calls[0][0]).toMatch(/Commander/);
    expect(bark.mock.calls[0][1]).toMatch(/cmd09300200/);
    expect(bark.mock.calls[0][1]).toMatch(/xian-m4/);
    const merged = JSON.parse(pool.calls.find((c) => /UPDATE tasks/.test(c.sql)).params[1]);
    expect(merged.commander_relaunch_count).toBe(3);
    expect(merged.commander_bark_at).toBeTruthy();
  });

  it('缺 tag/host 时从 working_memory commander_launch:<TAG> / task_runs / phone_registry 补齐；都补不到 → 跳过并留痕，不发 ssh', async () => {
    const bare = { id: 'task-bare', task_type: 'device_job', title: 'x', payload: { serial: 'ANGYVB4402004137', source: 'cron' } };
    const pool = makePool([
      [/FROM tasks[\s\S]*commander_heartbeat_at/, { rows: [bare] }],
      [/FROM task_runs/, { rows: [{ run_id: 'social-keyword-leadgen-crontab-cmd09300222__a1.discovery', ended_at: null }] }],
      [/FROM phone_registry/, { rows: [{ host: 'xian-m4', profile: 'legacy' }] }],
      [/FROM working_memory/, { rows: [{ value_json: { escort_id: 'esc-from-launch', host: 'xian-m4' } }] }],
      [/UPDATE tasks/, (sql, params) => ({ rows: [{ id: params[0] }], rowCount: 1 })],
    ]);
    const ssh = sshStub();
    const out = await runCommanderWatchdog(pool, { execFileFn: ssh.fn, bark: vi.fn(), gateMs: 0 });
    expect(out.relaunched).toBe(1);
    expect(ssh.seen[1].remote).toContain('cron rm esc-from-launch');
    expect(ssh.seen[2].remote).toContain("--name 'escort-xian-m4-cmd09300222'");

    const pool2 = makePool([
      [/FROM tasks[\s\S]*commander_heartbeat_at/, { rows: [{ ...bare, id: 'task-nohost', payload: { source: 'cron' } }] }],
      [/UPDATE tasks/, (sql, params) => ({ rows: [{ id: params[0] }], rowCount: 1 })],
    ]);
    const ssh2 = sshStub();
    const out2 = await runCommanderWatchdog(pool2, { execFileFn: ssh2.fn, bark: vi.fn(), gateMs: 0 });
    expect(out2.relaunched).toBe(0);
    expect(out2.skipped).toBe(1);
    expect(ssh2.fn).not.toHaveBeenCalled();
    const ev = pool2.calls.find((c) => /INSERT INTO task_events/.test(c.sql));
    expect(ev.params[1]).toBe('commander_relaunch_skipped');
  });

  it('同名 escort 仍在 cron 表（wf-run 自带看门狗刚重拉过）→ 收养其 id 不再 add；连续收养 2 次心跳仍缺 → 转 rm+add', async () => {
    const pool = makePool([
      [/FROM tasks[\s\S]*commander_heartbeat_at/, { rows: [RUN] }],
      [/UPDATE tasks/, (sql, params) => ({ rows: [{ id: params[0] }], rowCount: 1 })],
    ]);
    const ssh = sshStub(undefined, [{ id: 'esc-by-wfrun-77', name: 'escort-xian-m4-cmd09300200' }, { id: 'other', name: 'escort-xian-m1-cmd09300200' }]);
    const out = await runCommanderWatchdog(pool, { execFileFn: ssh.fn, bark: vi.fn(), gateMs: 0 });
    expect(out.adopted).toBe(1);
    expect(out.relaunched).toBe(0);
    expect(ssh.seen).toHaveLength(1);
    const merged = JSON.parse(pool.calls.find((c) => /UPDATE tasks/.test(c.sql)).params[1]);
    expect(merged).toMatchObject({ escort_id: 'esc-by-wfrun-77', commander_adopt_count: 1 });
    expect(merged.commander_relaunch_count).toBeUndefined();
    expect(pool.calls.find((c) => /INSERT INTO task_events/.test(c.sql)).params[1]).toBe('commander_adopted');

    const pool2 = makePool([
      [/FROM tasks[\s\S]*commander_heartbeat_at/, { rows: [{ ...RUN, payload: { ...RUN.payload, commander_adopt_count: 2, escort_id: 'esc-by-wfrun-77' } }] }],
      [/UPDATE tasks/, (sql, params) => ({ rows: [{ id: params[0] }], rowCount: 1 })],
    ]);
    const ssh2 = sshStub(undefined, [{ id: 'esc-by-wfrun-77', name: 'escort-xian-m4-cmd09300200' }]);
    const out2 = await runCommanderWatchdog(pool2, { execFileFn: ssh2.fn, bark: vi.fn(), gateMs: 0 });
    expect(out2.relaunched).toBe(1);
    expect(ssh2.seen.map((s) => s.remote.split(' ').slice(0, 3).join(' '))).toEqual(['openclaw cron rm', 'openclaw cron add', 'openclaw cron run']);
    expect(ssh2.seen[0].remote).toContain('cron rm esc-by-wfrun-77');
  });

  it('ssh add 失败 / 回包无 id → 不改计数，不 Bark，留痕 commander_relaunch_failed', async () => {
    const pool = makePool([
      [/FROM tasks[\s\S]*commander_heartbeat_at/, { rows: [RUN] }],
      [/UPDATE tasks/, (sql, params) => ({ rows: [{ id: params[0] }], rowCount: 1 })],
    ]);
    const ssh = sshStub('gateway busy');
    const bark = vi.fn();
    const out = await runCommanderWatchdog(pool, { execFileFn: ssh.fn, bark, gateMs: 0 });
    expect(out.relaunched).toBe(0);
    expect(out.failed).toBe(1);
    expect(bark).not.toHaveBeenCalled();
    expect(pool.calls.some((c) => /INSERT INTO task_events/.test(c.sql) && c.params[1] === 'commander_relaunch_failed')).toBe(true);
    // 失败也要推后下次尝试（commander_relaunched_at），否则每 5 分钟对网关狂敲
    const upd = pool.calls.find((c) => /UPDATE tasks/.test(c.sql));
    expect(JSON.parse(upd.params[1]).commander_relaunched_at).toBeTruthy();
    expect(JSON.parse(upd.params[1]).commander_relaunch_count).toBeUndefined();
  });
});

describe('runWorkflowTrendBark', () => {
  beforeEach(() => vi.clearAllMocks());
  // 北京 2026-09-30 09:05 = UTC 01:05
  const NOW = Date.parse('2026-09-30T01:05:00Z');

  it('同一 wf 连续 2 个自然日（北京）零线索 → Bark 一次；有线索的不叫；只在北京 08:30–10:00 窗口跑且当日去重', async () => {
    const trend = [
      { label: 'social-keyword-leadgen', day: '2026-09-29', runs: '3', leads: '0' },
      { label: 'social-keyword-leadgen', day: '2026-09-28', runs: '2', leads: '0' },
      { label: 'benchmark-leadgen', day: '2026-09-29', runs: '1', leads: '0' },
      { label: 'benchmark-leadgen', day: '2026-09-28', runs: '1', leads: '4' },
      { label: 'moments-repost', day: '2026-09-29', runs: '1', leads: '0' },
    ];
    const pool = makePool([
      [/Asia\/Shanghai/, (sql) => { expect(sql).toMatch(/::timestamptz AT TIME ZONE 'Asia\/Shanghai'/); return { rows: trend }; }],
      [/FROM phone_registry/, { rows: [] }],
      [/FROM working_memory/, { rows: [] }],
      [/INSERT INTO working_memory/, { rows: [] }],
    ]);
    const bark = vi.fn().mockResolvedValue(true);
    const out = await runWorkflowTrendBark(pool, { bark, now: NOW });
    expect(out.zeroLeads).toEqual(['social-keyword-leadgen']);
    expect(bark).toHaveBeenCalledTimes(1);
    expect(bark.mock.calls[0][1]).toMatch(/social-keyword-leadgen/);
    expect(bark.mock.calls[0][1]).not.toMatch(/benchmark-leadgen/);
    const wm = pool.calls.find((c) => /INSERT INTO working_memory/.test(c.sql));
    expect(wm.params[0]).toBe('workflow_trend_bark:last_day');
    expect(wm.params[1]).toContain('2026-09-30');
    // 窗口外不跑
    const out2 = await runWorkflowTrendBark(makePool([]), { bark: vi.fn(), now: Date.parse('2026-09-30T05:00:00Z') });
    expect(out2.skipped).toBe('outside_window');
    // 当日已发不重复
    const pool3 = makePool([[/FROM working_memory/, { rows: [{ value_json: { day: '2026-09-30' } }] }]]);
    const out3 = await runWorkflowTrendBark(pool3, { bark: vi.fn(), now: NOW });
    expect(out3.skipped).toBe('already_today');
  });

  it('一台 serial 近 72h 有批但 24h 无 completed → Bark 点名昵称；无批的闲置手机不叫', async () => {
    const pool = makePool([
      [/Asia\/Shanghai/, { rows: [] }],
      [/FROM phone_registry/, (sql) => { expect(sql).toMatch(/interval '72 hours'/); return { rows: [
        { serial: 'ANGYVB4402004137', nickname: '小黄', recent_runs: '4', last_ok: null },
        { serial: 'e6c7ef34', nickname: '小白', recent_runs: '0', last_ok: null },
        { serial: 'ANGYVB4227006983', nickname: '小蓝', recent_runs: '3', last_ok: '2026-09-29T20:00:00Z' },
      ] }; }],
      [/FROM working_memory/, { rows: [] }],
      [/INSERT INTO working_memory/, { rows: [] }],
    ]);
    const bark = vi.fn().mockResolvedValue(true);
    const out = await runWorkflowTrendBark(pool, { bark, now: NOW, staleSerialMs: 24 * 3600e3 });
    expect(out.staleSerials).toEqual(['ANGYVB4402004137']);
    expect(bark).toHaveBeenCalledTimes(1);
    expect(bark.mock.calls[0][1]).toMatch(/小黄/);
    expect(bark.mock.calls[0][1]).not.toMatch(/小白|小蓝/);
  });
});
