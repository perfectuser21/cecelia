/**
 * openclaw-agent-executor.test.js — 秋米非设备任务执行体（PR3 Task 5）
 *
 * 覆盖四件事：
 *  1. buildRemoteCommand：远端 .log/.exit/.pid 三件套 + prompt 只走 stdin，
 *     以及注入面（run_id/department/model/taskId 非法字符与路径穿越必须抛错）。
 *  2. **本机 sh 真跑一遍远端命令**（不靠 mock）：把 openclaw 换成假 bin，HOME 指到临时目录，
 *     断言 stdin 的正文真的到了 --message。审查发现的两条 Critical 都是这一层才照出来的：
 *     mock 断言「命令串里有 M=$(cat)」全绿，而真跑时 M 恒空——`&&` 链被 `&` 整体后台化，
 *     POSIX 异步列表的 stdin 接 /dev/null。字符串断言证明不了 shell 语义，只有真跑能。
 *  3. triggerOpenclawAgent：走 spawn（execFile 没有 input 选项，stdin 既不写也不关），
 *     ssh 参数复用 SSH_BASE_ARGS、目标机由 machine-registry 解析（不得写死机器名）。
 *  4. reapOpenclawAgentRuns：收割三态 EXIT=0 / EXIT≠0 / NO_EXIT + 取数上限与排序。
 *
 * 除第 2 条外全程不碰真机：ssh 一律经注入的 spawnFn / execFileFn mock。
 *
 * SSH_BASE_ARGS 的真身在 lib/ssh-args.js（PR1-B 终审 I6 从 notion-push-sync.js 抽出来的
 * 中立叶子模块）。这里 mock 它不是为了甩依赖——那个模块没有依赖——而是为了埋
 * SentinelBaseArgs：用一个真身里没有的哨兵值，证明被测模块是「展开那个共享常量」
 * 而不是自己抄了一份 ssh 参数。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('../lib/ssh-args.js', () => ({
  SSH_BASE_ARGS: Object.freeze([
    '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=no',
    '-o', 'SentinelBaseArgs=yes',
  ]),
}));
vi.mock('../lib/task-event-log.js', () => ({ recordTaskEventSafe: vi.fn().mockResolvedValue(true) }));
// 目标机必须是 sshTargetFor(resolvePrimaryWorkerId())：mock 只认 'fake-primary'，
// 实现里若写死 'us-mac-m4' 之类字面量，拿到的就是 WRONG:… 目标 → 断言红。
vi.mock('../machine-registry.js', () => ({
  resolvePrimaryWorkerId: vi.fn(() => 'fake-primary'),
  sshTargetFor: vi.fn((id) => (id === 'fake-primary' ? 'administrator@10.0.0.9' : `WRONG:${String(id)}`)),
}));
import { recordTaskEventSafe } from '../lib/task-event-log.js';
import { buildQiumiSource } from '../lib/qiumi-source.js';
import { buildRemoteCommand, triggerOpenclawAgent, reapOpenclawAgentRuns } from '../openclaw-agent-executor.js';

const task = {
  id: 'aaaaaaaa-1111-2222-3333-444444444444',
  task_type: 'qiumi_task',
  status: 'in_progress',
  payload: {
    run_id: 'qiumi-aaaaaaaa-1',
    model: 'claude-cli/claude-sonnet-5',
    qiumi_department: 'dev',
    qiumi_source: buildQiumiSource({ title: '标题', remark: '备', body: 'token: SECRET 正文' }),
  },
};

/** 假 ssh 子进程：stdin.end 记录写进去的正文，__emit 触发一轮 stdout→close。 */
function makeFakeChild({ code = 0, stdout = 'DISPATCHED\n', stderr = '', emitError = null } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: vi.fn() };
  child.kill = vi.fn();
  child.__emit = () => setImmediate(() => {
    if (emitError) { child.emit('error', emitError); return; }
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', code);
  });
  return child;
}
function spawnMock(opts) {
  const child = makeFakeChild(opts);
  const fn = vi.fn(() => { child.__emit(); return child; });
  fn.child = child;
  return fn;
}

beforeEach(() => vi.clearAllMocks());

describe('buildRemoteCommand', () => {
  it('nohup + .log/.exit/.pid 三件套，prompt 走 $M=$(cat)，不出现在命令行', () => {
    const c = buildRemoteCommand({ runId: 'r1', department: 'dev', model: 'claude-cli/claude-sonnet-5', taskId: 't1' });
    expect(c).toContain('M=$(cat)');
    expect(c).toContain('/opt/homebrew/bin/openclaw agent --agent dev --model claude-cli/claude-sonnet-5 --session-key agent:dev:r1 --message "$M" --timeout 1800 --json');
    expect(c).toContain('> ~/brain-runs/r1.log 2>&1; echo $? > ~/brain-runs/r1.exit');
    expect(c).toContain('echo $! > ~/brain-runs/r1.pid');
    expect(c).toContain('echo DISPATCHED');
    expect(c).not.toContain('正文');
  });

  it('读 stdin 与建目录在前台同步做完，只有 nohup 那段进后台（`&` 不许套住整条链）', () => {
    const c = buildRemoteCommand({ runId: 'r1', department: 'dev', model: 'm', taskId: 't1' });
    // `cmd1 && cmd2 &` 会把整条 AND 链后台化，而 POSIX 异步列表的 stdin 接 /dev/null → M 恒空；
    // 同时 mkdir 还没跑完 `echo $! > .../r1.pid` 就已经在前台执行 → 目录不存在，.pid 落空。
    // 幂等探针夹在 export M 与 nohup 之间（放在 M=$(cat) 之后是故意的：先把 stdin 读干净
    // 再决定走不走，远端提前退出会让本地写 stdin 撞 EPIPE）。
    expect(c).toMatch(/^mkdir -p ~\/brain-runs; M=\$\(cat\); export M; if \[ -f /);
    expect(c).toMatch(/fi; \{ nohup sh -c '/);
    expect(c).not.toContain('&& M=$(cat)');
    expect(c).not.toContain('&& nohup');
    expect(c).toMatch(/\}; echo DISPATCHED$/);
  });

  it('远端 sh -c 的单引号层不被 inner 截断（inner 内不得出现单引号）', () => {
    const c = buildRemoteCommand({ runId: 'r1', department: 'dev', model: 'openai/gpt-5.3-codex', taskId: 't1' });
    const inner = c.slice(c.indexOf("sh -c '") + 7, c.indexOf("' >/dev/null"));
    expect(inner).not.toContain("'");
    expect(inner).toContain('"$M"');
  });

  it('真实 model 串（含 / . -）必须放行', () => {
    expect(() => buildRemoteCommand({ runId: 'r1', department: 'dev', model: 'claude-cli/claude-sonnet-5', taskId: 't1' })).not.toThrow();
    expect(() => buildRemoteCommand({ runId: 'r1', department: 'dev', model: 'openai/gpt-5.3-codex', taskId: 't1' })).not.toThrow();
  });

  it('run_id/department/model 非法字符 → 抛错（注入面）', () => {
    expect(() => buildRemoteCommand({ runId: 'r;rm -rf', department: 'dev', model: 'm', taskId: 't' })).toThrow(/invalid/);
    expect(() => buildRemoteCommand({ runId: 'r', department: 'dev x', model: 'm', taskId: 't' })).toThrow(/invalid/);
    expect(() => buildRemoteCommand({ runId: 'r', department: 'dev', model: 'm$(id)', taskId: 't' })).toThrow(/invalid/);
    expect(() => buildRemoteCommand({ runId: 'r', department: 'dev', model: 'm`id`', taskId: 't' })).toThrow(/invalid/);
    expect(() => buildRemoteCommand({ runId: 'r', department: 'dev', model: 'm', taskId: "t'x" })).toThrow(/invalid/);
  });

  it('id 类字段不许带路径分隔符或 ..（写文件名，路径穿越面）', () => {
    // id 直接拼进 ~/brain-runs/<id>.log —— 带 / 或 .. 就能写到目录外（比如 ~/.ssh/）。
    expect(() => buildRemoteCommand({ runId: '../../.ssh/x', department: 'dev', model: 'm', taskId: 't' })).toThrow(/invalid/);
    expect(() => buildRemoteCommand({ runId: 'a/b', department: 'dev', model: 'm', taskId: 't' })).toThrow(/invalid/);
    expect(() => buildRemoteCommand({ runId: 'r..x', department: 'dev', model: 'm', taskId: 't' })).toThrow(/invalid/);
    expect(() => buildRemoteCommand({ runId: 'r', department: 'dev', model: 'a/../../b', taskId: 't' })).toThrow(/invalid/);
    expect(() => buildRemoteCommand({ runId: 'r', department: 'dev', model: 'm', taskId: '../t' })).toThrow(/invalid/);
  });
});

describe('远端命令在本机 sh 下真跑（反「字符串断言假绿」）', () => {
  it('stdin 的正文真的送进了 --message，.log/.exit/.pid 三件套真的落地', async () => {
    const home = join('/tmp', `qiumi-agent-${randomUUID().slice(0, 8)}`);
    mkdirSync(home, { recursive: true });
    try {
      // 假 openclaw：把收到的参数逐条打出来。inner 把 stdout 重定向进 .log，
      // 所以 --message 的实参会出现在 .log 里——正文到没到，一眼可验。
      const fakeBin = join(home, 'fakeclaw');
      writeFileSync(fakeBin, '#!/bin/sh\nfor a in "$@"; do echo "ARG:$a"; done\n');
      chmodSync(fakeBin, 0o755);

      const cmd = buildRemoteCommand({ runId: 'r1', department: 'dev', model: 'm', taskId: 't1', binPath: fakeBin });
      const res = spawnSync('sh', ['-c', cmd], {
        input: 'HELLOPROMPT', encoding: 'utf8', env: { HOME: home, PATH: process.env.PATH },
      });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('DISPATCHED');

      const exitFile = join(home, 'brain-runs', 'r1.exit');
      for (let i = 0; i < 100 && !existsSync(exitFile); i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(existsSync(exitFile)).toBe(true);
      expect(readFileSync(exitFile, 'utf8').trim()).toBe('0');
      expect(readFileSync(join(home, 'brain-runs', 'r1.log'), 'utf8')).toContain('HELLOPROMPT');
      expect(readFileSync(join(home, 'brain-runs', 'r1.pid'), 'utf8').trim()).toMatch(/^\d+$/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 20_000);
});

describe('triggerOpenclawAgent', () => {
  it('成功：走 spawn，正文经 stdin.end 送出（不进命令行），DISPATCHED → in_progress + executor_kind + 留痕', async () => {
    const spawnFn = spawnMock();
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const r = await triggerOpenclawAgent(task, { spawnFn, pool: { query } });
    expect(r).toMatchObject({ success: true, runId: 'qiumi-aaaaaaaa-1', executor: 'openclaw-agent' });

    const [cmd, args, opts] = spawnFn.mock.calls[0];
    expect(cmd).toBe('ssh');
    expect(args).toContain('administrator@10.0.0.9');
    expect(args).toContain('BatchMode=yes');
    expect(args).toContain('SentinelBaseArgs=yes');
    expect(opts.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    // 正文只走 stdin：必须写进去并关掉（不关的话远端 `M=$(cat)` 永远等不到 EOF）
    expect(spawnFn.child.stdin.end).toHaveBeenCalledTimes(1);
    expect(String(spawnFn.child.stdin.end.mock.calls[0][0])).toContain('SECRET');
    expect(args.join(' ')).not.toContain('SECRET');

    expect(query.mock.calls.some(([sql]) => /executor_kind = 'openclaw-agent'/.test(sql))).toBe(true);
    expect(query.mock.calls.some(([sql]) => /SET status = 'in_progress'/.test(sql))).toBe(true);
    expect(recordTaskEventSafe).toHaveBeenCalledWith(
      expect.anything(), task.id, 'openclaw_agent_spawned',
      expect.objectContaining({ run_id: 'qiumi-aaaaaaaa-1', machine: 'fake-primary' }),
    );
  });

  // dispatcher 主流程已先把任务标成 in_progress 再调本函数，但直派入口（任务仍 queued）
  // 也要能走通——CAS 收两种入口，重复派发同一条时是幂等的，不是改回旧状态。
  it('in_progress 迁移的 CAS 收 queued 与 in_progress 两种入口（幂等）', async () => {
    const spawnFn = spawnMock();
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    await triggerOpenclawAgent(task, { spawnFn, pool: { query } });
    const upd = query.mock.calls.find(([sql]) => /SET status = 'in_progress'/.test(sql));
    expect(upd[0]).toMatch(/AND status IN \('queued', 'in_progress'\)/);
    expect(upd[1]).toEqual([task.id]);
  });

  // spec 第 3 节：ssh 派发失败要重试一次再判死。难点在「第一次到底起没起」——
  // ssh 超时不等于远端没起来，直接重派会让同一个 session-key 的 agent 把同一件活跑第二遍。
  // 所以重试之前必须先探远端的 .pid/.exit，探到就当已派发成功。
  it('远端命令自带幂等探针：.pid 或 .exit 已在 → 回 ALREADY 且不重复起 agent', () => {
    const c = buildRemoteCommand({ runId: 'r1', department: 'dev', model: 'm', taskId: 't1' });
    expect(c).toMatch(/~\/brain-runs\/r1\.pid/);
    expect(c).toMatch(/~\/brain-runs\/r1\.exit/);
    expect(c, '没有 ALREADY 探针 → 重试会把同一件活跑两遍').toMatch(/ALREADY/);
  });

  it('本机 sh 真跑：同一条命令跑第二遍只回 ALREADY，不再起一次 agent', async () => {
    const home = join('/tmp', `qiumi-agent-${randomUUID().slice(0, 8)}`);
    mkdirSync(home, { recursive: true });
    try {
      // 假 openclaw 每次被调用就往计数文件追一行——跑了几遍数得出来，不靠字符串断言。
      const fakeBin = join(home, 'fakeclaw');
      writeFileSync(fakeBin, `#!/bin/sh\necho ran >> ${join(home, 'runs.count')}\n`);
      chmodSync(fakeBin, 0o755);
      const cmd = buildRemoteCommand({ runId: 'r2', department: 'dev', model: 'm', taskId: 't2', binPath: fakeBin });
      const env = { HOME: home, PATH: process.env.PATH };

      const first = spawnSync('sh', ['-c', cmd], { input: 'P', encoding: 'utf8', env });
      expect(first.stdout).toContain('DISPATCHED');
      const exitFile = join(home, 'brain-runs', 'r2.exit');
      for (let i = 0; i < 100 && !existsSync(exitFile); i++) await new Promise((r) => setTimeout(r, 50));

      const second = spawnSync('sh', ['-c', cmd], { input: 'P', encoding: 'utf8', env });
      expect(second.status).toBe(0);
      expect(second.stdout).toContain('ALREADY');
      expect(second.stdout).not.toContain('DISPATCHED');
      expect(readFileSync(join(home, 'runs.count'), 'utf8').trim().split('\n'), 'agent 被起了两遍').toHaveLength(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 20_000);

  it('第一次 ssh 超时/失败 → 重试一次；第二次探到 ALREADY → success（不再起第二个 agent）', async () => {
    let call = 0;
    const children = [];
    const spawnFn = vi.fn(() => {
      call += 1;
      const child = makeFakeChild(call === 1
        ? { emitError: new Error('ssh timeout') }
        : { stdout: 'ALREADY\n' });
      children.push(child);
      child.__emit();
      return child;
    });
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const r = await triggerOpenclawAgent(task, { spawnFn, pool: { query } });
    expect(r.success, '第一次失败就判死 → 远端已起的 agent 白跑，任务被误判失败').toBe(true);
    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.some(([sql]) => /SET status = 'in_progress'/.test(sql))).toBe(true);
  });

  it('两次都失败 → success:false，reason=openclaw_agent_spawn_failed，不动库', async () => {
    const spawnFn = vi.fn(() => {
      const child = makeFakeChild({ emitError: new Error('ssh down') });
      child.__emit();
      return child;
    });
    const query = vi.fn();
    const r = await triggerOpenclawAgent(task, { spawnFn, pool: { query } });
    expect(r).toMatchObject({ success: false, reason: 'openclaw_agent_spawn_failed' });
    expect(spawnFn, '只试了一次就判死').toHaveBeenCalledTimes(2);
    expect(query).not.toHaveBeenCalled();
  });

  it('缺 run_id/model → success:false 不 ssh', async () => {
    const spawnFn = vi.fn();
    const r = await triggerOpenclawAgent({ ...task, payload: { qiumi_source: buildQiumiSource() } }, { spawnFn, pool: { query: vi.fn() } });
    expect(r).toMatchObject({ success: false, reason: 'openclaw_agent_spawn_failed' });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('ssh 起不来 / 退出码非 0 / 输出无 DISPATCHED → success:false，不动库', async () => {
    const q1 = vi.fn();
    const r1 = await triggerOpenclawAgent(task, { spawnFn: spawnMock({ emitError: new Error('spawn ssh ENOENT') }), pool: { query: q1 } });
    expect(r1.success).toBe(false);
    expect(q1).not.toHaveBeenCalled();

    const q2 = vi.fn();
    const r2 = await triggerOpenclawAgent(task, { spawnFn: spawnMock({ code: 255, stdout: '', stderr: 'connect refused' }), pool: { query: q2 } });
    expect(r2.success).toBe(false);
    expect(q2).not.toHaveBeenCalled();

    const q3 = vi.fn();
    const r3 = await triggerOpenclawAgent(task, { spawnFn: spawnMock({ stdout: 'sh: openclaw: not found\n' }), pool: { query: q3 } });
    expect(r3.success).toBe(false);
    expect(q3).not.toHaveBeenCalled();
  });

  it('ssh 卡住不返回 → 每次 30s 超时 kill 掉，两次都卡住才 success:false（不能挂死整条派发）', async () => {
    vi.useFakeTimers();
    try {
      const children = [];
      const spawnFn = vi.fn(() => { // 永不 emit close
        const c = makeFakeChild();
        children.push(c);
        return c;
      });
      const p = triggerOpenclawAgent(task, { spawnFn, pool: { query: vi.fn() } });
      // 两次尝试各 30s：一次超时只该触发重试，不该直接判死
      await vi.advanceTimersByTimeAsync(31_000);
      await vi.advanceTimersByTimeAsync(31_000);
      const r = await p;
      expect(r.success).toBe(false);
      expect(children).toHaveLength(2);
      for (const c of children) expect(c.kill, '卡住的 ssh 没被 kill，进程会攒着').toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('reapOpenclawAgentRuns', () => {
  const row = { id: task.id, run_id: 'qiumi-aaaaaaaa-1' };

  it('EXIT=0 → completed_no_pr + receipt 子键（finalAssistantVisibleText）', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [], rowCount: 1 });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, 'EXIT=0\n{"finalAssistantVisibleText":"done ✓"}\n', ''));
    const r = await reapOpenclawAgentRuns({ query }, { execFileFn });
    expect(r).toEqual({ reaped: 1, completed: 1, failed: 0, requeued: 0 });
    const upd = query.mock.calls.find(([sql]) => /completed_no_pr/.test(sql));
    // 终态经 lib/task-terminal.js 收口：receipt 作 result jsonb 合并参数（$2），CAS 字面量 in_progress
    expect(upd[0]).toMatch(/result = COALESCE\(result, '\{\}'::jsonb\) \|\| \$2::jsonb/);
    expect(upd[0]).toMatch(/AND status = 'in_progress'/);
    expect(JSON.parse(upd[1][1]).receipt).toMatchObject({ exit: 0, text: 'done ✓' });
    expect(recordTaskEventSafe).toHaveBeenCalledWith(
      expect.anything(), task.id, 'openclaw_agent_reaped', expect.objectContaining({ run_id: row.run_id, exit: 0 }),
    );
  });

  it('--json 多行输出：从末尾往上找第一行能解析的 JSON，不被带大括号的正文骗走', async () => {
    const log = [
      'thinking… { 这行有大括号但不是 JSON }',
      '{"type":"progress","note":"{嵌套}"} 后面还跟了别的字所以整行不是合法 JSON',
      '{"finalAssistantVisibleText":"最终结论"}',
    ].join('\n');
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [], rowCount: 1 });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, `EXIT=0\n${log}\n`, ''));
    await reapOpenclawAgentRuns({ query }, { execFileFn });
    const upd = query.mock.calls.find(([sql]) => /completed_no_pr/.test(sql));
    expect(JSON.parse(upd[1][1]).receipt.text).toBe('最终结论');
  });

  it('EXIT=1 → failed + error_message=openclaw_agent_exit_1', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [], rowCount: 1 });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, 'EXIT=1\nboom\n', ''));
    const r = await reapOpenclawAgentRuns({ query }, { execFileFn });
    expect(r.failed).toBe(1);
    const upd = query.mock.calls.find(([sql]) => /SET status = 'failed'/.test(sql));
    expect(upd[1][1]).toBe('openclaw_agent_exit_1');
    expect(upd[0]).toMatch(/AND status = 'in_progress'/);
  });

  it('NO_EXIT → 不动（交给合同 stale 45min）', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, 'NO_EXIT\n', ''));
    const r = await reapOpenclawAgentRuns({ query }, { execFileFn });
    expect(r).toEqual({ reaped: 0, completed: 0, failed: 0, requeued: 0 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('取数带 LIMIT 10 + 老任务优先，单条 ssh 15s——整轮必须压在 job 的 300s 超时内', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [], rowCount: 1 });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, 'EXIT=0\n{}\n', ''));
    await reapOpenclawAgentRuns({ query }, { execFileFn });
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/executor_kind = 'openclaw-agent'/);
    expect(sql).toMatch(/status = 'in_progress'/);
    expect(sql).toMatch(/ORDER BY started_at ASC NULLS FIRST/);
    expect(sql).toMatch(/LIMIT 10/);
    expect(execFileFn.mock.calls[0][2].timeout).toBeLessThanOrEqual(15_000);
    expect(execFileFn.mock.calls[0][1]).toContain('administrator@10.0.0.9');
  });

  it('run_id 非法（含路径穿越）→ 跳过，不发 ssh', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: task.id, run_id: 'r;rm -rf ~' }, { id: task.id, run_id: '../../.ssh/x' }] });
    const execFileFn = vi.fn();
    const r = await reapOpenclawAgentRuns({ query }, { execFileFn });
    expect(r).toEqual({ reaped: 0, completed: 0, failed: 0, requeued: 0 });
    expect(execFileFn).not.toHaveBeenCalled();
  });
});

describe('promptOf 设备提示段（device_hint）', () => {
  const okPool = () => ({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) });
  const withHint = (hint) => ({ ...task, payload: { ...task.payload, qiumi_route: { device_hint: hint } } });
  const sentBody = (spawnFn) => String(spawnFn.child.stdin.end.mock.calls[0][0]);

  it('is_device=true → 正文含序列号、按 host 派生的节点名、控制器名、lock-acquire、timeout 300000', async () => {
    const spawnFn = spawnMock();
    await triggerOpenclawAgent(withHint({ is_device: true, serial: 'S1', host: 'xian-m4' }), { spawnFn, pool: okPool() });
    const body = sentBody(spawnFn);
    expect(body).toContain('设备提示');
    expect(body).toContain('S1');
    expect(body).toContain('XIAN-M4-PHONE');
    expect(body).toContain('douyin-phone-adb');
    expect(body).toContain('lock-acquire');
    expect(body).toContain('300000');
    // 原有三段仍在
    expect(body).toContain('token: SECRET 正文');
  });

  it('is_device=false 或没有 device_hint → 正文不含设备提示', async () => {
    const a = spawnMock();
    await triggerOpenclawAgent(withHint({ is_device: false, serial: null, host: null }), { spawnFn: a, pool: okPool() });
    expect(sentBody(a)).not.toContain('设备提示');
    const b = spawnMock();
    await triggerOpenclawAgent(task, { spawnFn: b, pool: okPool() });
    expect(sentBody(b)).not.toContain('设备提示');
  });

  it('host 缺失 → 节点名写「未知」并提示 openclaw nodes list，不抛', async () => {
    const spawnFn = spawnMock();
    await triggerOpenclawAgent(withHint({ is_device: true, serial: 'S2', host: null }), { spawnFn, pool: okPool() });
    const body = sentBody(spawnFn);
    expect(body).toContain('S2');
    expect(body).toContain('openclaw nodes list');
    expect(body).not.toContain('-PHONE');
  });

  it('台账定案（nickname/profile/account 齐）→ 明确写节点/profile/序列号/手机/目标抖音号 + account-current 核对，不再让 agent 去 tsv 猜', async () => {
    const spawnFn = spawnMock();
    await triggerOpenclawAgent(withHint({
      is_device: true, serial: 'ANGYVB4402004137', host: 'xian-m4', profile: 'legacy', nickname: '小黄',
      account: { id: '44997267357', nickname: '人工智能小诺考评', current: true }, resolvedBy: 'nickname',
    }), { spawnFn, pool: okPool() });
    const body = sentBody(spawnFn);
    expect(body).toContain('节点 XIAN-M4-PHONE');
    expect(body).toContain('profile legacy');
    expect(body).toContain('序列号 ANGYVB4402004137');
    expect(body).toContain('手机 小黄');
    expect(body).toContain('目标抖音号 44997267357（人工智能小诺考评）');
    expect(body).toContain('account-current');
    expect(body).toContain('不得换手机');
    expect(body).toContain('--profile legacy');
    expect(body).toContain('lock-acquire');
    expect(body).not.toContain('douyin-phone-profiles.tsv');
  });

  it('台账定案但该号没有 id（只有昵称）→ 目标抖音号只写昵称', async () => {
    const spawnFn = spawnMock();
    await triggerOpenclawAgent(withHint({
      is_device: true, serial: 'S9', host: 'xian-m1', profile: 'p9', nickname: '小彩',
      account: { id: null, nickname: '秦军餐饮', current: false },
    }), { spawnFn, pool: okPool() });
    expect(sentBody(spawnFn)).toContain('目标抖音号 秦军餐饮');
  });

  it('Jev 含糊（verdict=ambiguous）→ 正文仍含设备提示，首行提示可能要碰真机', async () => {
    const spawnFn = spawnMock();
    await triggerOpenclawAgent(
      withHint({ is_device: false, verdict: 'ambiguous', p: 0.5, serial: null, host: null }),
      { spawnFn, pool: okPool() },
    );
    const body = sentBody(spawnFn);
    expect(body).toContain('设备提示');
    expect(body).toContain('可能要碰真机');
    expect(body).toContain('p=0.5');
    expect(body).toContain('openclaw nodes list');
  });
});

describe('模型可选 + 超时 / 思考强度（任务 0d4215f2）', () => {
  it('model 为空 → 命令里不带 --model（交给 agent 自身默认模型）', () => {
    const c = buildRemoteCommand({ runId: 'r1', department: 'skill-factory', model: null, taskId: 't1' });
    expect(c).toContain('/opt/homebrew/bin/openclaw agent --agent skill-factory --session-key agent:skill-factory:r1 --message "$M" --timeout 1800 --json');
    expect(c).not.toContain('--model');
  });

  it('timeoutSec 进 --timeout；越界（<60 或 >10800）回落 1800', () => {
    expect(buildRemoteCommand({ runId: 'r1', department: 'dev', model: null, taskId: 't1', timeoutSec: 1200 })).toContain('--timeout 1200 ');
    expect(buildRemoteCommand({ runId: 'r1', department: 'dev', model: null, taskId: 't1', timeoutSec: 5 })).toContain('--timeout 1800 ');
    expect(buildRemoteCommand({ runId: 'r1', department: 'dev', model: null, taskId: 't1', timeoutSec: 99999 })).toContain('--timeout 1800 ');
  });

  it('thinking 白名单内 → --thinking；白名单外 → 抛 invalid（注入面）', () => {
    expect(buildRemoteCommand({ runId: 'r1', department: 'dev', model: null, taskId: 't1', thinking: 'high' })).toContain('--thinking high ');
    expect(() => buildRemoteCommand({ runId: 'r1', department: 'dev', model: null, taskId: 't1', thinking: 'x;rm' })).toThrow(/invalid/);
  });

  it('triggerOpenclawAgent：payload 没有 model 也能派发，并把 timeout_sec / thinking 带进命令', async () => {
    const spawnFn = spawnMock();
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const t = { ...task, payload: { ...task.payload, model: null, timeout_sec: 1200, thinking: 'medium' } };
    const r = await triggerOpenclawAgent(t, { spawnFn, pool: { query } });
    expect(r).toMatchObject({ success: true });
    const remote = spawnFn.mock.calls[0][1].join(' ');
    expect(remote).not.toContain('--model');
    expect(remote).toContain('--timeout 1200');
    expect(remote).toContain('--thinking medium');
  });

  it('triggerOpenclawAgent：缺执行者（qiumi_department）仍然拒绝', async () => {
    const spawnFn = spawnMock();
    const t = { ...task, payload: { ...task.payload, qiumi_department: null } };
    const r = await triggerOpenclawAgent(t, { spawnFn, pool: { query: vi.fn() } });
    expect(r).toMatchObject({ success: false, reason: 'openclaw_agent_spawn_failed' });
    expect(spawnFn).not.toHaveBeenCalled();
  });
});

describe('每次运行一个新会话 + 回执解析（任务 7951bd36）', () => {
  it('会话键按 run_id 而不是 task_id：同一任务重排后换新会话，agent 无法凭旧会话记忆复述', () => {
    const a = buildRemoteCommand({ runId: 'qiumi-aaaaaaaa-1', department: 'foundry', model: null, taskId: 't1' });
    const b = buildRemoteCommand({ runId: 'qiumi-aaaaaaaa-2', department: 'foundry', model: null, taskId: 't1' });
    expect(a).toContain('--session-key agent:foundry:qiumi-aaaaaaaa-1 ');
    expect(b).toContain('--session-key agent:foundry:qiumi-aaaaaaaa-2 ');
  });

  it('回执：真实 --json 是多行缩进 JSON，且尾巴从对象中间截断 → 仍能取出 finalAssistantVisibleText', async () => {
    const tail = [
      '          "schemaChars": 360',
      '        }',
      '      },',
      '      "finalAssistantVisibleText": "{\\"phone\\":\\"小龙虾\\",\\"ok\\":true}",',
      '      "stopReason": "stop"',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const row = { id: task.id, run_id: 'qiumi-aaaaaaaa-1' };
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [], rowCount: 1 });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, `EXIT=0\n${tail}\n`, ''));
    await reapOpenclawAgentRuns({ query }, { execFileFn });
    const upd = query.mock.calls.find(([sql]) => /completed_no_pr/.test(sql));
    expect(JSON.parse(upd[1][1]).receipt.text).toBe('{"phone":"小龙虾","ok":true}');
  });

  it('收割读日志尾巴放大到 20000 字节（4000 常截在最终回答之前）', async () => {
    const row = { id: task.id, run_id: 'qiumi-aaaaaaaa-1' };
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [], rowCount: 1 });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, 'EXIT=0\n{"finalAssistantVisibleText":"x"}\n', ''));
    await reapOpenclawAgentRuns({ query }, { execFileFn });
    expect(execFileFn.mock.calls[0][1].join(' ')).toContain('tail -c 20000');
  });
});

// 0929 23:52 生产实证（任务 55c2e84b）：Brain 已按执行参数起 `--agent media --model openai/gpt-6-sol`，
// 但 prompt 原样带着「执行参数：/执行Agent：media/模型：sol」块，agent 当成"要再派 media/sol 去做"，
// sessions_spawn 开子会话后 sessions_yield；Brain 收到 exit 0 + result.payloads=[] 判成完成，
// 真机操作在追踪外跑完。两刀：prompt 顶部声明参数已应用并去掉参数块；收割器不把 yield 判完成。
describe('执行参数已应用：prompt 不再诱导 agent 自派子会话（任务 e3c81cce）', () => {
  const okPool = () => ({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) });
  const sentBody = (spawnFn) => String(spawnFn.child.stdin.end.mock.calls[0][0]);
  const body55c = [
    '执行参数：',
    '执行Agent：media',
    '模型：sol',
    '超时：30分钟',
    '设备：小彩手机',
    '验收：截图回传成功',
    '',
    '具体任务：只读验证，不做任何点赞/评论/私信/发布/切号。',
    '1. 加锁，打开抖音进入「我」页，执行 account-current 读取当前账号。',
  ].join('\n');
  const withParams = (payloadExtra = {}, body = body55c) => ({
    ...task,
    payload: {
      ...task.payload,
      model: 'openai/gpt-6-sol',
      qiumi_department: 'media',
      timeout_sec: 1800,
      acceptance: '截图回传成功',
      qiumi_route: { device_hint: { requested: '小彩手机' } },
      qiumi_source: buildQiumiSource({ title: '【修复验收T1】小彩sol截图', remark: '', body }),
      ...payloadExtra,
    },
  });

  it('prompt 顶部声明「你就是 media / 模型 / 超时」并禁止 sessions_spawn / sessions_yield', async () => {
    const spawnFn = spawnMock();
    await triggerOpenclawAgent(withParams(), { spawnFn, pool: okPool() });
    const body = sentBody(spawnFn);
    expect(body.startsWith('执行参数已由 Brain 应用：你就是 media，本次模型 openai/gpt-6-sol，超时 30 分钟。')).toBe(true);
    expect(body).toContain('直接在本会话完成任务，不要 sessions_spawn 子会话，不要 sessions_yield 等待。');
  });

  it('正文里已应用的执行参数块被去掉，其余正文保留；验收/设备要求不丢', async () => {
    const spawnFn = spawnMock();
    await triggerOpenclawAgent(withParams(), { spawnFn, pool: okPool() });
    const body = sentBody(spawnFn);
    expect(body, '参数块原样留在正文 → agent 会当成"要再派 media/sol"').not.toContain('执行Agent：media');
    expect(body).not.toContain('模型：sol');
    expect(body).not.toMatch(/(^|\n)执行参数：\n/);
    expect(body).toContain('具体任务：只读验证');
    expect(body).toContain('account-current');
    expect(body).toContain('【修复验收T1】小彩sol截图');
    expect(body).toContain('验收：截图回传成功');
    expect(body).toContain('设备：小彩手机');
  });

  it('【执行参数】…【执行参数结束】写法同样去块；未写模型 → 写明用该 agent 默认模型', async () => {
    const spawnFn = spawnMock();
    const b = '前言一句\n【执行参数】\n执行Agent：foundry\n【执行参数结束】\n后文保留';
    await triggerOpenclawAgent(withParams({ model: null, qiumi_department: 'foundry', timeout_sec: null, acceptance: null, qiumi_route: null }, b), { spawnFn, pool: okPool() });
    const body = sentBody(spawnFn);
    expect(body).toContain('你就是 foundry，本次模型 foundry 默认模型，超时 30 分钟。');
    expect(body).not.toContain('【执行参数】');
    expect(body).not.toContain('执行Agent：foundry');
    expect(body).toContain('前言一句');
    expect(body).toContain('后文保留');
  });

  it('超时按实际下发值写（与 --timeout 同一口径，越界回落 30 分钟）', async () => {
    const a = spawnMock();
    await triggerOpenclawAgent(withParams({ timeout_sec: 1200 }), { spawnFn: a, pool: okPool() });
    expect(sentBody(a)).toContain('超时 20 分钟。');
    const b = spawnMock();
    await triggerOpenclawAgent(withParams({ timeout_sec: 5 }), { spawnFn: b, pool: okPool() });
    expect(sentBody(b)).toContain('超时 30 分钟。');
  });

  it('正文没有执行参数块 → prompt 与改动前逐字一致（不加说明）', async () => {
    const spawnFn = spawnMock();
    await triggerOpenclawAgent(task, { spawnFn, pool: okPool() });
    expect(sentBody(spawnFn)).toBe('标题\n\n补充说明：备\n\n页面正文：\ntoken: SECRET 正文');
  });
});

describe('收割器：agent 以 yield 收尾、没有最终结果 → 不判完成（任务 e3c81cce）', () => {
  const row = { id: task.id, run_id: 'qiumi-55c2e84b-1' };
  // 55c2e84b 真实 .log 的形状：开头 result.payloads=[]；尾部 meta.yielded=true + acceptedSessionSpawns。
  // tail -c 20000 读不到开头，所以两类信号都要能单独认出来。
  const yieldTail = [
    '      "livenessState": "paused",',
    '      "yielded": true,',
    '      "stopReason": "end_turn",',
    '      "toolSummary": { "calls": 8, "tools": ["agents_list", "bash", "sessions_spawn", "sessions_yield"], "failures": 1 }',
    '    },',
    '    "acceptedSessionSpawns": [',
    '      { "runId": "b73bfb6a", "childSessionKey": "agent:media:subagent:94d3d839", "expectsCompletionMessage": true }',
    '    ],',
    '    "requesterContinuationSettled": true',
    '  }',
    '}',
  ].join('\n');
  const reap = async (stdout) => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [], rowCount: 1 });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, stdout, ''));
    const r = await reapOpenclawAgentRuns({ query }, { execFileFn });
    return { r, query };
  };

  it('EXIT=0 + yielded=true + 无最终文本 → failed(agent_yielded_without_result)，不写 completed_no_pr', async () => {
    const { r, query } = await reap(`EXIT=0\n${yieldTail}\n`);
    expect(r).toEqual({ reaped: 1, completed: 0, failed: 1, requeued: 0 });
    expect(query.mock.calls.some(([sql]) => /completed_no_pr/.test(sql)), 'yield 收尾被判完成').toBe(false);
    const upd = query.mock.calls.find(([sql]) => /SET status = 'failed'/.test(sql));
    expect(upd[0]).toMatch(/AND status = 'in_progress'/);
    expect(upd[1]).toContain('agent_yielded_without_result');
    const merged = JSON.parse(upd[1].find((v) => typeof v === 'string' && v.includes('receipt')));
    expect(merged.receipt.exit).toBe(0);
    expect(merged.receipt.log_tail).toContain('"yielded": true');
    expect(merged.yield_summary).toMatchObject({ yielded: true, child_sessions: ['agent:media:subagent:94d3d839'] });
    expect(recordTaskEventSafe).toHaveBeenCalledWith(
      expect.anything(), task.id, 'openclaw_agent_reaped',
      expect.objectContaining({ run_id: row.run_id, exit: 0, reason: 'agent_yielded_without_result' }),
    );
  });

  it('EXIT=0 + result.payloads 为空且无最终文本（未见 yielded 字段）→ 同样 failed', async () => {
    const head = '{\n  "runId": "x",\n  "status": "ok",\n  "result": {\n    "payloads": [],\n    "meta": { "durationMs": 1 }\n  }\n}';
    const { r, query } = await reap(`EXIT=0\n${head}\n`);
    expect(r.failed).toBe(1);
    expect(r.completed).toBe(0);
    const upd = query.mock.calls.find(([sql]) => /SET status = 'failed'/.test(sql));
    expect(upd[1]).toContain('agent_yielded_without_result');
  });

  it('EXIT=0 + 有最终文本（无 yield 信号）→ 仍判 completed_no_pr', async () => {
    const { r, query } = await reap('EXIT=0\n{"finalAssistantVisibleText":"已完成：截图 a.jpg 12KB","result":{"payloads":[{"text":"已完成"}]}}\n');
    expect(r).toEqual({ reaped: 1, completed: 1, failed: 0, requeued: 0 });
    expect(query.mock.calls.some(([sql]) => /completed_no_pr/.test(sql))).toBe(true);
  });
});
