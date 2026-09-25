/**
 * script-executor.test.js —— executor=script 的派发/收割逻辑（链 bf5088a3 棒3 PR B，任务 5cdbd52a）。
 *
 * 两类断言：
 *   ① 纯函数：job 脚本引号转义、runner 只含安全常量与 base64、收割输出解析、env 值脱敏、run_id 确定性。
 *   ② 远端 runner 真跑：把 buildRunnerScript 的产物用本机 sh 真执行（HOME 指向临时目录，**不发 ssh**），
 *      证明 exit 收割 / 超时杀进程组 / ALREADY 幂等 / env 与 cwd 生效 / job 文件用完即焚。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  scriptRunIdFor,
  attemptNumberOf,
  buildJobScript,
  buildRunnerScript,
  buildReapCommand,
  parseReapOutput,
  redactEnvValues,
  triggerScriptRun,
} from '../script-executor.js';
import { SCRIPT_LIMITS } from '../lib/script-task-spec.js';

const TID = '11111111-2222-3333-4444-555555555555';

describe('run_id / attempt（硬约束 3 幂等的根）', () => {
  it('run_id 由 task.id + 尝试序号确定性生成，同一次尝试永远同一个 id', () => {
    expect(scriptRunIdFor(TID, 1)).toBe(`script-${TID}-a1`);
    expect(scriptRunIdFor(TID, 1)).toBe(scriptRunIdFor(TID, 1));
    expect(scriptRunIdFor(TID, 2)).not.toBe(scriptRunIdFor(TID, 1));
  });

  it('attemptNumberOf = 已记录失败次数 + 1', () => {
    expect(attemptNumberOf({})).toBe(1);
    expect(attemptNumberOf({ script_attempts: [] })).toBe(1);
    expect(attemptNumberOf({ script_attempts: [{}, {}] })).toBe(3);
  });

  it('非法 task id / attempt 拒绝（run_id 要当远端文件名）', () => {
    expect(() => scriptRunIdFor('../x', 1)).toThrow();
    expect(() => scriptRunIdFor(TID, 0)).toThrow();
    expect(() => scriptRunIdFor(TID, 1.5)).toThrow();
  });
});

describe('buildJobScript：cmd/cwd/env 只做数据，值一律单引号转义', () => {
  it('env 值里的单引号/美元符/反引号不能逃逸', () => {
    const s = buildJobScript({ cmd: 'echo hi', cwd: null, env: { SCRIPT_X: `a'b$(id)\`c"d` } });
    expect(s).toContain(`export SCRIPT_X='a'\\''b$(id)\`c"d'`);
    expect(s.trimEnd().split('\n').at(-1)).toBe('echo hi');
  });

  it('cwd：绝对路径与 ~/ 都被引号包住，cd 失败退出 125', () => {
    expect(buildJobScript({ cmd: 'x', cwd: "/opt/it's", env: {} })).toContain(`cd '/opt/it'\\''s' || exit 125`);
    expect(buildJobScript({ cmd: 'x', cwd: '~/work dir', env: {} })).toContain(`cd "$HOME"/'work dir' || exit 125`);
    expect(buildJobScript({ cmd: 'x', cwd: '~', env: {} })).toContain('cd "$HOME" || exit 125');
  });
});

describe('buildRunnerScript：发往 ssh stdin 的脚本只含安全常量与 base64', () => {
  const job = buildJobScript({ cmd: 'echo SECRET_CMD_MARKER; rm -rf /tmp/x', cwd: null, env: { SCRIPT_TOKEN: 'TOPSECRETVALUE' } });
  const runner = buildRunnerScript({ runId: scriptRunIdFor(TID, 1), timeoutSec: 90, jobScript: job });

  it('cmd 与 env 值不以明文出现在 runner 里（走 base64）', () => {
    expect(runner).not.toContain('SECRET_CMD_MARKER');
    expect(runner).not.toContain('TOPSECRETVALUE');
    expect(runner).toContain(Buffer.from(job).toString('base64'));
  });

  it('非法 run_id / timeout / 越界拒绝', () => {
    expect(() => buildRunnerScript({ runId: "x'; id #", timeoutSec: 10, jobScript: job })).toThrow(/runId/);
    expect(() => buildRunnerScript({ runId: 'ok-1', timeoutSec: 0, jobScript: job })).toThrow(/timeout/);
    expect(() => buildRunnerScript({ runId: 'ok-1', timeoutSec: SCRIPT_LIMITS.MAX_TIMEOUT_SEC + 1, jobScript: job })).toThrow(/timeout/);
    expect(() => buildRunnerScript({ runId: 'ok-1', timeoutSec: 1.5, jobScript: job })).toThrow(/timeout/);
  });
});

describe('收割输出解析与脱敏', () => {
  const nonce = 'abc123';
  it('EXIT + 分段 stdout/stderr（marker 带 nonce，输出里伪造 marker 骗不了解析）', () => {
    const forged = `---ERR-other---\nfake`;
    const out = `EXIT=3\nTIMEDOUT=0\n---OUT-${nonce}---\nline1\n${forged}\n---ERR-${nonce}---\nboom\n`;
    const r = parseReapOutput(out, nonce);
    expect(r.exit).toBe(3);
    expect(r.timedOut).toBe(false);
    expect(r.stdout).toContain('line1');
    expect(r.stdout).toContain(forged);
    expect(r.stderr).toBe('boom\n');
  });

  it('超时标记与 NO_EXIT', () => {
    expect(parseReapOutput(`EXIT=124\nTIMEDOUT=1\n---OUT-${nonce}---\n---ERR-${nonce}---\n`, nonce)).toMatchObject({ exit: 124, timedOut: true });
    expect(parseReapOutput('NO_EXIT\n', nonce)).toBeNull();
    expect(parseReapOutput('garbage', nonce)).toBeNull();
  });

  it('stdout 只留尾部 64KB、stderr 尾部 4KB', () => {
    const big = 'x'.repeat(SCRIPT_LIMITS.MAX_STDOUT_BYTES + 5000);
    const r = parseReapOutput(`EXIT=0\nTIMEDOUT=0\n---OUT-${nonce}---\n${big}\n---ERR-${nonce}---\n${'e'.repeat(9000)}`, nonce);
    expect(Buffer.byteLength(r.stdout)).toBeLessThanOrEqual(SCRIPT_LIMITS.MAX_STDOUT_BYTES);
    expect(Buffer.byteLength(r.stderr)).toBeLessThanOrEqual(SCRIPT_LIMITS.MAX_STDERR_BYTES);
  });

  it('收割命令只含安全常量（run_id / nonce 过白名单）', () => {
    const c = buildReapCommand(scriptRunIdFor(TID, 1), nonce);
    expect(c).toContain(`brain-runs/script-${TID}-a1.exit`);
    expect(() => buildReapCommand("a'b", nonce)).toThrow();
    expect(() => buildReapCommand('ok', "n'x")).toThrow();
  });

  it('redactEnvValues：env 值在 stdout/stderr 里被替换为 ***，短值（<3 字符）不动以免误伤', () => {
    const t = redactEnvValues('token=TOPSECRETVALUE ok a=1 TOPSECRETVALUE', { SCRIPT_TOKEN: 'TOPSECRETVALUE', SCRIPT_A: '1' });
    expect(t).toBe('token=*** ok a=1 ***');
    expect(redactEnvValues('nothing', {})).toBe('nothing');
  });
});

describe('triggerScriptRun：ssh 传输安全（假传输，不发真 ssh）', () => {
  const basePayload = { host: 'xian-m4', cmd: 'echo SECRET_CMD_MARKER', timeout_sec: 30, env: { SCRIPT_TOKEN: 'TOPSECRETVALUE' } };
  const mkTask = (over = {}) => ({ id: TID, task_type: 'script_run', payload: { ...basePayload, ...over } });
  const mkPool = () => ({ query: vi.fn(async () => ({ rows: [], rowCount: 1 })) });

  function fakeSpawn(stdoutText, { code = 0 } = {}) {
    const calls = [];
    const fn = (bin, args) => {
      const rec = { bin, args, stdin: '' };
      calls.push(rec);
      const handlers = {};
      const child = {
        stdout: { on: (e, cb) => { if (e === 'data') setTimeout(() => cb(stdoutText), 0); } },
        stderr: { on: () => {} },
        stdin: { end: (d) => { rec.stdin = String(d ?? ''); } },
        on: (e, cb) => { handlers[e] = cb; if (e === 'close') setTimeout(() => cb(code), 5); },
        kill: () => {},
      };
      return child;
    };
    fn.calls = calls;
    return fn;
  }

  it('cmd/env 值不出现在 ssh 命令行，只经 stdin 的 base64；目标是注册表解析出的跑场机；写 executor_kind/run/事件', async () => {
    const spawnFn = fakeSpawn('DISPATCHED\n');
    const pool = mkPool();
    const r = await triggerScriptRun(mkTask(), { spawnFn, pool });
    expect(r).toMatchObject({ success: true, taskId: TID, executor: 'script', runId: `script-${TID}-a1` });
    expect(spawnFn.calls).toHaveLength(1);
    const { args, stdin } = spawnFn.calls[0];
    expect(args.join(' ')).not.toContain('SECRET_CMD_MARKER');
    expect(args.join(' ')).not.toContain('TOPSECRETVALUE');
    expect(args.some((a) => /jinnuoshengyuan@/.test(a))).toBe(true);
    expect(stdin).not.toContain('SECRET_CMD_MARKER');
    expect(stdin).not.toContain('TOPSECRETVALUE');
    const sqls = pool.query.mock.calls.map(([sql]) => sql).join('\n');
    expect(sqls).toMatch(/executor_kind = 'script'/);
    expect(sqls).toMatch(/INSERT INTO task_runs/);
    const events = pool.query.mock.calls.filter(([sql]) => /INSERT INTO task_events/.test(sql));
    expect(events.length).toBeGreaterThan(0);
    for (const [, params] of events) {
      const text = JSON.stringify(params);
      expect(text).not.toContain('TOPSECRETVALUE');
      expect(text).not.toContain('SECRET_CMD_MARKER');
    }
    // 事件/留痕里只有 env 键名
    expect(JSON.stringify(events)).toContain('SCRIPT_TOKEN');
  });

  it('远端回 ALREADY（重试/重启）→ 视为已派发，不再起第二个进程', async () => {
    const r = await triggerScriptRun(mkTask(), { spawnFn: fakeSpawn('ALREADY\n'), pool: mkPool() });
    expect(r.success).toBe(true);
    expect(r.alreadyRunning).toBe(true);
  });

  it('ssh 失败重试一次后判死：success=false, reason=script_spawn_failed（dispatcher 据此回队/计数）', async () => {
    const spawnFn = fakeSpawn('', { code: 255 });
    const r = await triggerScriptRun(mkTask(), { spawnFn, pool: mkPool() });
    expect(r.success).toBe(false);
    expect(r.reason).toBe('script_spawn_failed');
    expect(spawnFn.calls).toHaveLength(2);
  });

  it('派发前再校验：host 为 us-vps / payload 违规 → 不发 ssh，reason=script_payload_invalid，终态类错误', async () => {
    const spawnFn = fakeSpawn('DISPATCHED\n');
    const r = await triggerScriptRun(mkTask({ host: 'us-vps' }), { spawnFn, pool: mkPool() });
    expect(r).toMatchObject({ success: false, reason: 'script_payload_invalid', taskTerminal: true });
    expect(r.error).toMatch(/调度器|零执行/);
    expect(spawnFn.calls).toHaveLength(0);
  });

  it('远端没回 DISPATCHED 标记 → 不当成功（失败如实）', async () => {
    const r = await triggerScriptRun(mkTask(), { spawnFn: fakeSpawn('weird output\n'), pool: mkPool() });
    expect(r.success).toBe(false);
  });
});

describe('远端 runner 真跑（本机 sh，HOME=临时目录，不发 ssh）', () => {
  let home;
  beforeAll(() => { home = mkdtempSync(join(tmpdir(), 'script-runner-')); });
  afterAll(() => { rmSync(home, { recursive: true, force: true }); });

  const runRunner = (runId, jobOpts, timeoutSec = 20) => {
    const script = buildRunnerScript({ runId, timeoutSec, jobScript: buildJobScript(jobOpts) });
    return spawnSync('sh', ['-s'], { input: script, env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 15000 });
  };
  const waitExit = async (runId, ms = 15000) => {
    const f = join(home, 'brain-runs', `${runId}.exit`);
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (existsSync(f)) return Number(readFileSync(f, 'utf8').trim());
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`等 ${runId}.exit 超时`);
  };
  const out = (runId, ext) => readFileSync(join(home, 'brain-runs', `${runId}.${ext}`), 'utf8');

  it('成功：exit 0，stdout/stderr 分开落文件，env/cwd 生效，job 文件用完即焚', async () => {
    const cwdDir = join(home, 'work dir');
    spawnSync('mkdir', ['-p', cwdDir]);
    const rid = scriptRunIdFor('aaaaaaaa-0000-0000-0000-000000000001', 1);
    const r = runRunner(rid, { cmd: 'echo "out:$SCRIPT_X:$(pwd)"; echo err1 >&2', cwd: cwdDir, env: { SCRIPT_X: "it's $HOME" } });
    expect(r.stdout.trim()).toBe('DISPATCHED');
    expect(await waitExit(rid)).toBe(0);
    expect(out(rid, 'out').trim()).toBe(`out:it's $HOME:${cwdDir}`);
    expect(out(rid, 'err').trim()).toBe('err1');
    await new Promise((res) => setTimeout(res, 200));
    expect(readdirSync(join(home, 'brain-runs')).some((f) => f === `${rid}.sh`)).toBe(false);
  });

  it('失败如实：exit 7 原样收割，不伪造成功', async () => {
    const rid = scriptRunIdFor('aaaaaaaa-0000-0000-0000-000000000002', 1);
    runRunner(rid, { cmd: 'echo bad >&2; exit 7', cwd: null, env: {} });
    expect(await waitExit(rid)).toBe(7);
    expect(out(rid, 'err').trim()).toBe('bad');
    expect(existsSync(join(home, 'brain-runs', `${rid}.timedout`))).toBe(false);
  });

  it('cwd 不存在 → exit 125，不在错误目录里跑命令', async () => {
    const rid = scriptRunIdFor('aaaaaaaa-0000-0000-0000-000000000003', 1);
    runRunner(rid, { cmd: 'echo SHOULD_NOT_RUN', cwd: '/no/such/dir/xyz', env: {} });
    expect(await waitExit(rid)).toBe(125);
    expect(out(rid, 'out')).not.toContain('SHOULD_NOT_RUN');
  });

  it('幂等（硬约束 3）：同一 run_id 第二次投递回 ALREADY，命令不会跑第二遍', async () => {
    const rid = scriptRunIdFor('aaaaaaaa-0000-0000-0000-000000000004', 1);
    const counter = join(home, 'counter');
    runRunner(rid, { cmd: `echo x >> '${counter}'`, cwd: null, env: {} });
    await waitExit(rid);
    const again = runRunner(rid, { cmd: `echo x >> '${counter}'`, cwd: null, env: {} });
    expect(again.stdout.trim()).toBe('ALREADY');
    await new Promise((res) => setTimeout(res, 300));
    expect(readFileSync(counter, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('超时杀进程组并标失败（硬约束 2）：exit 124 + timedout 标记，孙进程也被杀', async () => {
    const rid = scriptRunIdFor('aaaaaaaa-0000-0000-0000-000000000005', 1);
    const marker = `sleep 4${Math.floor(Math.random() * 9000 + 1000)}`; // 独特命令行便于 pgrep
    runRunner(rid, { cmd: `sh -c '${marker}' & wait`, cwd: null, env: {} }, 2);
    expect(await waitExit(rid, 20000)).toBe(124);
    expect(existsSync(join(home, 'brain-runs', `${rid}.timedout`))).toBe(true);
    await new Promise((res) => setTimeout(res, 500));
    const alive = spawnSync('pgrep', ['-f', marker], { encoding: 'utf8' });
    expect(alive.stdout.trim()).toBe('');
  }, 30000);
});
