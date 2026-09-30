/**
 * workflow-run-lost-deadline.test.js — 整批总时限到期判 lost + 收割器放锁回桌面（任务 c2d73868，决策 3c98fb36）。
 *
 * 09-30 事故：三部手机各卡 6 小时、escort 被移除后无人陪跑，Brain 侧镜像单一直 in_progress。
 * 这里钉死：到期无 finalize → failed(lost_deadline) + 三条善后 ssh（放锁 / 回桌面 / 注销 escort）被调用；
 * 未到期不动（判据在 SQL 内）；已善后过的只重写终态不再发 ssh；善后失败 fail-open 仍判 lost。
 * 外部命令一律桩掉，绝不真发 ssh。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sshTargetFor } from '../machine-registry.js';
import {
  runWorkflowRunLostDeadline,
  resolveDeadlineMs,
  workflowRunLabel,
  deriveRunTag,
  LOST_REASON,
  DEFAULT_DEADLINE_MS,
  DEFAULT_GRACE_MS,
} from '../workflow-run-lost-deadline.js';

const XIAN_M4 = sshTargetFor('xian-mac-m4');
const MMV = sshTargetFor('us-mac-m4');

function makePool({ stale = [], runs = [], phones = {} } = {}) {
  const calls = [];
  const query = vi.fn(async (sql, params) => {
    const text = String(sql);
    calls.push({ sql: text, params });
    if (/FROM tasks/.test(text) && /status\s*=\s*'in_progress'/.test(text) && /SELECT/.test(text)) {
      return { rows: stale };
    }
    if (/FROM task_runs/.test(text)) {
      return { rows: runs.filter((r) => r.task_id === params[0]) };
    }
    if (/FROM phone_registry/.test(text)) {
      const p = phones[params[0]];
      return { rows: p ? [p] : [] };
    }
    if (/UPDATE tasks/.test(text)) {
      return { rows: [{ id: params[0], status: 'failed' }], rowCount: 1 };
    }
    if (/UPDATE task_runs/.test(text)) {
      return { rows: [{ id: 'r', task_id: params[0], status: 'timeout', result: {} }] };
    }
    return { rows: [] };
  });
  return { query, calls };
}

function sshStub() {
  const seen = [];
  const fn = vi.fn((cmd, args, opts, cb) => {
    seen.push({ cmd, args, target: args[args.length - 2], remote: args[args.length - 1] });
    cb(null, 'ok\n', '');
  });
  return { fn, seen };
}

const STALE_MIRROR = {
  id: 'task-lost', title: '获客采收·AI人工智能训练师 · 4137 · 02:00 · abc123', task_type: 'device_job',
  payload: { serial: 'ANGYVB4402004137', source: 'cron', read_only: true, escort_id: 'd417a34c-0000-4000-8000-000000000001' },
  started_at: null, due_at: '2026-09-30T02:00:00Z', created_at: '2026-09-30T02:00:00Z',
};

describe('resolveDeadlineMs / workflowRunLabel / deriveRunTag', () => {
  it('默认 4h + 30min 宽限，env 可配', () => {
    expect(resolveDeadlineMs({})).toBe(DEFAULT_DEADLINE_MS + DEFAULT_GRACE_MS);
    expect(resolveDeadlineMs({ WORKFLOW_RUN_DEADLINE_MS: '3600000', WORKFLOW_RUN_DEADLINE_GRACE_MS: '60000' })).toBe(3_660_000);
    expect(resolveDeadlineMs({ WORKFLOW_RUN_DEADLINE_MS: 'abc' })).toBe(DEFAULT_DEADLINE_MS + DEFAULT_GRACE_MS);
  });

  it('能力名只认 payload.wf_id / capability / cap，绝不从账本 run_id 前缀推', () => {
    expect(workflowRunLabel({ payload: { wf_id: 'benchmark-leadgen' }, title: 'x' })).toBe('benchmark-leadgen');
    expect(workflowRunLabel({ payload: { capability: '对标获客' } })).toBe('对标获客');
    expect(workflowRunLabel({ payload: { cap: 'social-keyword-leadgen' } })).toBe('social-keyword-leadgen');
    // 对标 run 的账本 run_id 前缀写死 social-keyword-leadgen-crontab-，没有能力字段时退回任务标题，不认前缀
    expect(workflowRunLabel({ payload: {}, title: '获客采收·对标 · 4137', task_type: 'device_job' })).toBe('获客采收·对标 · 4137');
    expect(workflowRunLabel({ payload: {}, title: '', task_type: 'workflow_run' })).toBe('workflow_run');
  });

  it('TAG：payload.tag / run_tag 优先，否则取最新账本 run_id（<账本run>__aN.<stage>）最后一段', () => {
    expect(deriveRunTag({ payload: { tag: 'cmd09300200' } }, ['social-keyword-leadgen-crontab-auto1__a1.delivery'])).toBe('cmd09300200');
    expect(deriveRunTag({ payload: { run_tag: 'auto09300200' } }, [])).toBe('auto09300200');
    expect(deriveRunTag({ payload: {} }, ['social-keyword-leadgen-crontab-cmd09300200__a1.discovery'])).toBe('cmd09300200');
    expect(deriveRunTag({ payload: {} }, ['notion-abc-1'])).toBe('1');
    expect(deriveRunTag({ payload: {} }, [])).toBe(null);
    expect(deriveRunTag({ payload: { tag: 'bad tag; rm -rf' } }, [])).toBe(null);
  });
});

describe('runWorkflowRunLostDeadline', () => {
  beforeEach(() => vi.clearAllMocks());

  it('到期无 finalize → failed(lost_deadline) + 放锁/回桌面/注销 escort 三条 ssh + task_events + task_runs timeout', async () => {
    const pool = makePool({
      stale: [STALE_MIRROR],
      runs: [{ task_id: 'task-lost', run_id: 'social-keyword-leadgen-crontab-cmd09300200__a1.collection' }],
      phones: { ANGYVB4402004137: { host: 'xian-m4', profile: 'legacy' } },
    });
    const ssh = sshStub();
    const out = await runWorkflowRunLostDeadline(pool, { execFileFn: ssh.fn, gateMs: 0 });

    expect(out.lost).toBe(1);
    // 判据在 SQL：总时限毫秒作为参数进库比较，禁 JS 解析无时区时间
    const sel = pool.calls.find((c) => /FROM tasks/.test(c.sql) && /in_progress/.test(c.sql));
    expect(sel.sql).toMatch(/COALESCE\(started_at, due_at, created_at\) < NOW\(\)/);
    expect(sel.sql).toMatch(/task_type = 'workflow_run'/);
    expect(sel.sql).toMatch(/task_type = 'device_job' AND payload->>'source' = 'cron'/);
    expect(sel.params[0]).toBe(DEFAULT_DEADLINE_MS + DEFAULT_GRACE_MS);

    // 终态经 lib/task-terminal.js 收口：status 是 SQL 字面量，result 合并 reason=lost_deadline，CAS 仅 in_progress
    const upd = pool.calls.find((c) => /UPDATE tasks/.test(c.sql) && c.params?.[0] === 'task-lost');
    expect(upd.sql).toContain("status = 'failed'");
    expect(upd.sql).toMatch(/status = 'in_progress'/);
    const merged = upd.params.map((p) => (typeof p === 'string' ? p : '')).join('\n');
    expect(merged).toContain(`"reason":"${LOST_REASON}"`);
    expect(merged).toContain('"lost_cleanup_at"');

    // 三条善后：执行机放锁 + 回桌面（同一台机、同 profile、owner=TAG），MMV 注销 escort
    expect(ssh.seen).toHaveLength(3);
    expect(ssh.seen[0].target).toBe(XIAN_M4);
    expect(ssh.seen[0].remote).toContain('douyin-phone-adb --profile legacy lock-release cmd09300200');
    expect(ssh.seen[1].target).toBe(XIAN_M4);
    expect(ssh.seen[1].remote).toContain('douyin-phone-adb --profile legacy return-safe-desktop');
    expect(ssh.seen[2].target).toBe(MMV);
    expect(ssh.seen[2].remote).toContain('openclaw cron rm d417a34c-0000-4000-8000-000000000001');
    // ssh 参数数组：远端串是单个 argv，本地零 shell
    for (const s of ssh.seen) expect(s.cmd).toBe('ssh');

    // 处置留痕 + 未收尾 run 补 timeout
    const ev = pool.calls.find((c) => /INSERT INTO task_events/.test(c.sql));
    expect(ev.params[0]).toBe('task-lost');
    expect(ev.params[1]).toBe(LOST_REASON);
    const run = pool.calls.find((c) => /UPDATE task_runs/.test(c.sql));
    expect(run.params[0]).toBe('social-keyword-leadgen-crontab-cmd09300200__a1.collection');
    expect(run.params[1]).toBe('timeout');
  });

  it('未到期（SQL 查不出）不动：零 UPDATE、零 ssh', async () => {
    const pool = makePool({ stale: [] });
    const ssh = sshStub();
    const out = await runWorkflowRunLostDeadline(pool, { execFileFn: ssh.fn, gateMs: 0 });
    expect(out.lost).toBe(0);
    expect(pool.calls.some((c) => /UPDATE tasks/.test(c.sql))).toBe(false);
    expect(ssh.fn).not.toHaveBeenCalled();
  });

  it('已善后过（payload.lost_cleanup_at 在）只重写终态，不重发 ssh——对账把行翻回 in_progress 也不重复放锁', async () => {
    const pool = makePool({
      stale: [{ ...STALE_MIRROR, payload: { ...STALE_MIRROR.payload, lost_cleanup_at: '2026-09-30T06:35:00Z' } }],
      phones: { ANGYVB4402004137: { host: 'xian-m4', profile: 'legacy' } },
    });
    const ssh = sshStub();
    const out = await runWorkflowRunLostDeadline(pool, { execFileFn: ssh.fn, gateMs: 0 });
    expect(out.lost).toBe(1);
    expect(ssh.fn).not.toHaveBeenCalled();
    expect(pool.calls.some((c) => /UPDATE tasks/.test(c.sql) && c.sql.includes("status = 'failed'"))).toBe(true);
  });

  it('善后 fail-open：ssh 报错 / 机器不在注册表 / 缺 escort id 都只记录，任务照判 lost', async () => {
    const pool = makePool({
      stale: [
        { ...STALE_MIRROR, id: 'task-ssh-err', payload: { serial: 'ANGYVB4402004137', source: 'cron' } },
        { ...STALE_MIRROR, id: 'task-unknown-host', payload: { serial: 'S-NOWHERE', source: 'cron', host: 'mars-pc', profile: 'p' } },
      ],
      phones: { ANGYVB4402004137: { host: 'xian-m4', profile: 'legacy' } },
    });
    const execFileFn = vi.fn((cmd, args, opts, cb) => cb(Object.assign(new Error('ssh: connect timed out'), { stderr: 'timeout' })));
    const out = await runWorkflowRunLostDeadline(pool, { execFileFn, gateMs: 0 });
    expect(out.lost).toBe(2);
    // 第一条：两条执行机命令都试了（各自失败），没有 escort id 不发 MMV
    expect(execFileFn).toHaveBeenCalledTimes(2);
    const upd1 = pool.calls.find((c) => /UPDATE tasks/.test(c.sql) && c.params?.[0] === 'task-ssh-err');
    expect(upd1.params.join('\n')).toContain('"lock_release":"failed"');
    // 第二条：机器不在注册表 → 善后整体跳过仍判 lost
    const upd2 = pool.calls.find((c) => /UPDATE tasks/.test(c.sql) && c.params?.[0] === 'task-unknown-host');
    expect(upd2.sql).toContain("status = 'failed'");
    expect(upd2.params.join('\n')).toContain('"skipped"');
  });

  it('workflow_run（Notion ssh 直派）到期同样判 lost：machine 取 payload，缺 serial/profile 时跳过放锁只记录', async () => {
    const pool = makePool({
      stale: [{
        id: 'task-wf', title: '[run] 金诺采收·直驾@xian-mac-m4', task_type: 'workflow_run',
        payload: { run_id: 'notion-aa-1', wf_id: 'JinoHarvestDirect', channel: 'ssh', machine: 'xian-mac-m4' },
        started_at: '2026-09-30T00:00:00Z', due_at: null, created_at: '2026-09-30T00:00:00Z',
      }],
    });
    const ssh = sshStub();
    const out = await runWorkflowRunLostDeadline(pool, { execFileFn: ssh.fn, gateMs: 0 });
    expect(out.lost).toBe(1);
    expect(ssh.fn).not.toHaveBeenCalled();
    const ev = pool.calls.find((c) => /INSERT INTO task_events/.test(c.sql));
    expect(JSON.parse(ev.params[2]).capability).toBe('JinoHarvestDirect');
  });

  it('进程内 5min 自 gate：连续两次只跑一次', async () => {
    const pool = makePool({ stale: [] });
    const a = await runWorkflowRunLostDeadline(pool, { execFileFn: vi.fn(), now: 1_000_000, gateMs: 300_000 });
    const b = await runWorkflowRunLostDeadline(pool, { execFileFn: vi.fn(), now: 1_060_000, gateMs: 300_000 });
    expect(a.skipped).toBeUndefined();
    expect(b.skipped).toBe('interval_gate');
  });
});
