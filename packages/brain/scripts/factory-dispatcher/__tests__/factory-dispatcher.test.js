import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as fsp from 'node:fs/promises';

import {
  isWithinWorkHours,
  shanghaiYmd,
  parseFactoryContract,
  buildRunId,
  buildSessionId,
  buildAgentMessage,
  decodeUtf8Strict,
  writeMessageFile,
  parseLockStatus,
  remoteLockCommand,
  hostSelfCheck,
  detectOkFalse,
  dispatchTask,
  pollOnce,
} from '../factory-dispatcher.js';

const MODULE_PATH = fileURLToPath(new URL('../factory-dispatcher.js', import.meta.url));
const TASK_ID = 'abcdef12-3456-7890-abcd-ef1234567890';
// 2026-10-11 14:00 上海 = 06:00 UTC
const DAYTIME = Date.parse('2026-10-11T06:00:00Z');

function makeTask(overrides = {}) {
  return {
    id: TASK_ID,
    status: 'queued',
    payload: {
      factory_dispatch: true,
      factory: {
        stage: '3',
        workflow_key: 'douyin-collect',
        device: { node: 'xian-m4', profile: 'jinnuo', serial: 'SERIAL01' },
        agent: 'skill-factory',
        skill: 'android-douyin-bgm-collect',
        ...overrides,
      },
    },
  };
}

/** 假世界：时钟、Brain、远端设备锁、OpenClaw 会话全部可控。 */
function makeWorld({ task = makeTask(), lockOwner = null, claimStatus = 200, start = DAYTIME } = {}) {
  const w = {
    t: start,
    task: { ...task },
    lockOwner,
    patches: [],
    claims: [],
    sshCalls: [],
    spawned: [],
    logText: '',
    agentExited: false,
    agentExitCode: null,
    killed: false,
    files: new Map(),
    onTick: null,
  };
  const deps = {
    now: () => new Date(w.t),
    sleep: async (ms) => {
      w.t += ms;
      if (w.onTick) w.onTick(w);
    },
    log: () => {},
    brain: {
      listQueued: async () => (w.task.status === 'queued' ? [w.task] : []),
      getTask: async () => ({ ...w.task }),
      claim: async (id) => {
        w.claims.push(id);
        return { status: claimStatus };
      },
      patch: async (id, body) => {
        w.patches.push(body);
        if (body.status) w.task.status = body.status;
        if (body.result) w.task.result = { ...(w.task.result || {}), ...body.result };
        return { status: 200 };
      },
    },
    runSsh: async (host, cmd) => {
      w.sshCalls.push({ host, cmd });
      const m = cmd.match(/douyin-phone-adb --profile (\S+) (lock-\w+)(?: (\S+))?$/);
      if (!m) return { code: 1, stdout: '', stderr: 'bad cmd' };
      const [, , sub, arg] = m;
      if (sub === 'lock-status') {
        return { code: 0, stdout: w.lockOwner ? `lock=held owner=${w.lockOwner} age=5s stale=false reclaimable=false ttl=1800s\n` : 'lock=free\n', stderr: '' };
      }
      if (sub === 'lock-acquire') {
        if (w.lockOwner && w.lockOwner !== arg) return { code: 1, stdout: '', stderr: `lock is held by another run: ${w.lockOwner}` };
        w.lockOwner = arg;
        return { code: 0, stdout: `lock=acquired owner=${arg}\nlock_evidence_id=${arg}-lock-acquire\n`, stderr: '' };
      }
      if (sub === 'lock-release') {
        if (!w.lockOwner) return { code: 0, stdout: 'lock=free\n', stderr: '' };
        if (w.lockOwner !== arg) return { code: 1, stdout: '', stderr: 'refusing to release lock owned by another run' };
        w.lockOwner = null;
        return { code: 0, stdout: `lock=released owner=${arg}\n`, stderr: '' };
      }
      if (sub === 'lock-refresh') {
        if (w.lockOwner !== arg) return { code: 1, stdout: '', stderr: 'refusing' };
        return { code: 0, stdout: `lock=refreshed owner=${arg} ttl=1800s\n`, stderr: '' };
      }
      return { code: 1, stdout: '', stderr: 'unknown' };
    },
    spawnAgent: async (spec) => {
      w.spawned.push(spec);
      return {
        isExited: () => w.agentExited,
        exitCode: () => w.agentExitCode,
        kill: async () => {
          w.killed = true;
          w.agentExited = true;
        },
      };
    },
    readLog: async () => w.logText,
    writeFile: async (p, buf) => w.files.set(p, Buffer.from(buf)),
    readFile: async (p) => w.files.get(p),
    mkdir: async () => {},
  };
  const opts = {
    claimer: 'factory-dispatcher@test',
    stateDir: '/state',
    lockPollMs: 60_000,
    lockWaitTimeoutMs: 10 * 60_000,
    sessionPollMs: 30_000,
    sessionTimeoutMs: 60 * 60_000,
    exitGraceMs: 2 * 60_000,
    lockRefreshMs: 10 * 60_000,
  };
  return { w, deps, opts };
}

const lastFailed = (w) => [...w.patches].reverse().find((p) => p.status === 'failed');

describe('时段闸与日期', () => {
  it('上海 09:00–23:00 内放行，外拒绝', () => {
    expect(isWithinWorkHours(new Date('2026-10-11T01:00:00Z'))).toBe(true); // 09:00
    expect(isWithinWorkHours(new Date('2026-10-11T00:59:00Z'))).toBe(false); // 08:59
    expect(isWithinWorkHours(new Date('2026-10-11T14:59:00Z'))).toBe(true); // 22:59
    expect(isWithinWorkHours(new Date('2026-10-11T15:00:00Z'))).toBe(false); // 23:00
  });

  it('run_id 按上海日期跨天（UTC 16:00 已是上海次日）', () => {
    expect(shanghaiYmd(new Date('2026-10-11T15:59:00Z'))).toBe('20261011');
    expect(shanghaiYmd(new Date('2026-10-11T16:00:00Z'))).toBe('20261012');
    expect(buildRunId({ runPrefix: 'sf3', taskId: TASK_ID, date: new Date('2026-10-11T16:30:00Z'), round: 2 }))
      .toBe('sf3-abcdef12-20261012-r2');
  });

  it('会话 id = sf-<stage>-<task8>', () => {
    expect(buildSessionId('3', TASK_ID)).toBe('sf-3-abcdef12');
  });
});

describe('任务契约解析', () => {
  it('补默认值：ssh_host=xian-m4、round=1、run_prefix=sf<stage>', () => {
    const r = parseFactoryContract(makeTask());
    expect(r.ok).toBe(true);
    expect(r.contract.device.ssh_host).toBe('xian-m4');
    expect(r.contract.round).toBe(1);
    expect(r.contract.run_prefix).toBe('sf3');
  });

  it('factory_dispatch 不是 true 拒绝', () => {
    const t = makeTask();
    t.payload.factory_dispatch = 'true';
    expect(parseFactoryContract(t).ok).toBe(false);
  });

  it('profile 带 shell 元字符拒绝（防 ssh 注入）', () => {
    const r = parseFactoryContract(makeTask({ device: { node: 'n', profile: 'p;rm -rf ~', serial: 's' } }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/profile/);
  });

  it('run_prefix 非法、ssh_host 以 - 开头、agent 不是 skill-factory、round 非正整数、skill 为空 均拒绝', () => {
    expect(parseFactoryContract(makeTask({ run_prefix: 'a b' })).ok).toBe(false);
    expect(parseFactoryContract(makeTask({ device: { node: 'n', profile: 'p', serial: 's', ssh_host: '-oProxyCommand=x' } })).ok).toBe(false);
    expect(parseFactoryContract(makeTask({ agent: 'main' })).ok).toBe(false);
    expect(parseFactoryContract(makeTask({ round: 0 })).ok).toBe(false);
    expect(parseFactoryContract(makeTask({ skill: '' })).ok).toBe(false);
  });

  it('远端锁命令只拼白名单字符', () => {
    expect(remoteLockCommand('jinnuo', 'lock-acquire', 'sf3-abcdef12-20261011-r1'))
      .toBe('export PATH=$HOME/.local/bin:$PATH; douyin-phone-adb --profile jinnuo lock-acquire sf3-abcdef12-20261011-r1');
    expect(() => remoteLockCommand('a$(x)', 'lock-status')).toThrow();
    expect(() => remoteLockCommand('a', 'lock-acquire', 'x;y')).toThrow();
  });

  it('解析 lock-status 回执', () => {
    expect(parseLockStatus('lock=free\n')).toEqual({ state: 'free', owner: null });
    expect(parseLockStatus('lock=held owner=sf3-x age=3s stale=false\n')).toEqual({ state: 'held', owner: 'sf3-x' });
    expect(parseLockStatus('garbage')).toEqual({ state: 'unknown', owner: null });
  });
});

describe('消息文件 UTF-8', () => {
  it('消息含 run_id、任务 id、锁纪律与交付要求', () => {
    const { contract } = parseFactoryContract(makeTask({ message: '附加说明：先截图' }));
    const msg = buildAgentMessage({ runId: 'sf3-abcdef12-20261011-r1', taskId: TASK_ID, contract });
    expect(msg).toContain('sf3-abcdef12-20261011-r1');
    expect(msg).toContain(TASK_ID);
    expect(msg).toContain('锁已由派发器代领，开工 lock-status 核对，不要再 lock-acquire；结束必须 lock-release 并回读 free');
    expect(msg).toContain('先读任务正文按【执行参数】执行；结束把交付 JSON 写入 result.delivery');
    expect(msg).toContain('附加说明：先截图');
  });

  it('LANG=C 子进程写出的中文文件字节与 UTF-8 编码完全一致', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fd-utf8-'));
    const file = join(dir, 'msg.txt');
    const text = '锁已由派发器代领——【执行参数】✅ émoji 🚀';
    const script = `import { writeMessageFile } from ${JSON.stringify(pathToFileURL(MODULE_PATH).href)};
      import * as fsp from 'node:fs/promises';
      await writeMessageFile(${JSON.stringify(file)}, ${JSON.stringify(text)}, { writeFile: fsp.writeFile, readFile: fsp.readFile });`;
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' },
    });
    expect(Buffer.compare(readFileSync(file), Buffer.from(text, 'utf8'))).toBe(0);
  });

  it('读回非法 UTF-8 字节拒绝', async () => {
    expect(() => decodeUtf8Strict(Buffer.from([0xe9, 0x94]))).toThrow();
    const dir = mkdtempSync(join(tmpdir(), 'fd-bad-'));
    const file = join(dir, 'msg.txt');
    const corrupting = {
      writeFile: async (p) => writeFileSync(p, Buffer.from([0x41, 0xff, 0xfe])),
      readFile: fsp.readFile,
    };
    await expect(writeMessageFile(file, '中文', corrupting)).rejects.toThrow();
  });
});

describe('宿主自检（us-vps 零执行）', () => {
  it('linux 拒绝', () => {
    expect(hostSelfCheck({ platform: 'linux', env: {}, exists: () => false }).ok).toBe(false);
  });
  it('容器内拒绝', () => {
    expect(hostSelfCheck({ platform: 'darwin', env: {}, exists: (p) => p === '/.dockerenv' }).ok).toBe(false);
    expect(hostSelfCheck({ platform: 'darwin', env: { container: 'docker' }, exists: () => false }).ok).toBe(false);
  });
  it('macOS 本机放行', () => {
    expect(hostSelfCheck({ platform: 'darwin', env: {}, exists: () => false }).ok).toBe(true);
  });
});

describe('ok:false 检测', () => {
  it('识别并带出原文', () => {
    const r = detectOkFalse('{"ok": true}\nstuff\n{"ok": false, "error": "gateway 断开"}\n');
    expect(r).toContain('gateway 断开');
    expect(detectOkFalse('{"ok": true}')).toBeNull();
  });
});

describe('派发流程', () => {
  it('时段外不 claim', async () => {
    const { w, deps, opts } = makeWorld({ start: Date.parse('2026-10-11T16:00:00Z') }); // 上海 00:00
    const r = await pollOnce(deps, opts);
    expect(r.skipped).toBe('off_hours');
    expect(w.claims).toHaveLength(0);
  });

  it('claim 409 跳过，不动锁也不改状态', async () => {
    const { w, deps, opts } = makeWorld({ claimStatus: 409 });
    const r = await dispatchTask(w.task, deps, opts);
    expect(r.outcome).toBe('claim_conflict');
    expect(w.patches).toHaveLength(0);
    expect(w.sshCalls).toHaveLength(0);
  });

  it('只派 factory_dispatch=true 的任务', async () => {
    const t = makeTask();
    t.payload.factory_dispatch = false;
    const { w, deps, opts } = makeWorld({ task: t });
    const r = await pollOnce(deps, opts);
    expect(r.skipped).toBe('no_task');
    expect(w.claims).toHaveLength(0);
  });

  it('正常路径：代领锁→启动会话（UTF-8 环境）→会话自己 completed 后派发器放锁', async () => {
    const { w, deps, opts } = makeWorld();
    w.onTick = (ww) => {
      if (ww.spawned.length && ww.t - DAYTIME > 5 * 60_000) ww.task.status = 'completed';
    };
    const r = await dispatchTask(w.task, deps, opts);
    expect(r.outcome).toBe('session_terminal');
    expect(w.patches[0]).toMatchObject({ status: 'in_progress' });
    const spec = w.spawned[0];
    expect(spec.args).toEqual(expect.arrayContaining(['agent', '--agent', 'skill-factory', '--session-id', 'sf-3-abcdef12', '--thinking', 'high', '--timeout', '3000', '--json', '--message-file']));
    expect(spec.env.LANG).toBe('en_US.UTF-8');
    expect(spec.env.LC_ALL).toBe('en_US.UTF-8');
    const msg = decodeUtf8Strict(w.files.get(spec.messageFile));
    expect(msg).toContain('sf3-abcdef12-20261011-r1');
    expect(w.lockOwner).toBeNull();
    expect(w.task.status).toBe('completed');
    expect(w.patches.some((p) => p.status === 'failed')).toBe(false);
  });

  it('ok:false 晚到：杀会话、放自己的锁、落 failed 且 fail_reason 带原文', async () => {
    const { w, deps, opts } = makeWorld();
    w.onTick = (ww) => {
      if (ww.spawned.length && ww.t - DAYTIME > 3 * 60_000) ww.logText = '{"ok": false, "error": "模型额度耗尽"}';
    };
    const r = await dispatchTask(w.task, deps, opts);
    expect(r.outcome).toBe('failed');
    expect(w.killed).toBe(true);
    expect(w.lockOwner).toBeNull();
    expect(w.task.status).toBe('failed');
    expect(lastFailed(w).result.fail_reason).toContain('模型额度耗尽');
  });

  it('他人占锁：只等不接管不释放，等超时落 failed', async () => {
    const { w, deps, opts } = makeWorld({ lockOwner: 'harvest-batch7' });
    const r = await dispatchTask(w.task, deps, opts);
    expect(r.outcome).toBe('failed');
    expect(w.lockOwner).toBe('harvest-batch7');
    expect(w.sshCalls.some((c) => /lock-(acquire|release|refresh)/.test(c.cmd))).toBe(false);
    expect(w.spawned).toHaveLength(0);
    expect(lastFailed(w).result.fail_reason).toMatch(/lock_wait_timeout/);
    expect(lastFailed(w).result.fail_reason).toContain('harvest-batch7');
    // 等待期间周期性 PATCH in_progress
    expect(w.patches.filter((p) => p.status === 'in_progress').length).toBeGreaterThan(2);
  });

  it('他人锁中途释放后派发器拿到锁并开工', async () => {
    const { w, deps, opts } = makeWorld({ lockOwner: 'harvest-batch7' });
    w.onTick = (ww) => {
      if (ww.t - DAYTIME >= 3 * 60_000 && ww.lockOwner === 'harvest-batch7') ww.lockOwner = null;
      if (ww.spawned.length) ww.task.status = 'completed';
    };
    const r = await dispatchTask(w.task, deps, opts);
    expect(r.outcome).toBe('session_terminal');
    expect(w.spawned).toHaveLength(1);
  });

  it('会话超时：杀会话、放锁、落 failed', async () => {
    const { w, deps, opts } = makeWorld();
    const r = await dispatchTask(w.task, deps, opts);
    expect(r.outcome).toBe('failed');
    expect(w.killed).toBe(true);
    expect(w.lockOwner).toBeNull();
    expect(lastFailed(w).result.fail_reason).toMatch(/session_timeout/);
  });

  it('会话期间锁被他人换走：不释放他人的锁', async () => {
    const { w, deps, opts } = makeWorld();
    w.onTick = (ww) => {
      if (ww.spawned.length) ww.lockOwner = 'intruder-run';
    };
    const r = await dispatchTask(w.task, deps, opts);
    expect(r.outcome).toBe('failed');
    expect(w.lockOwner).toBe('intruder-run');
  });

  it('会话期间对自己的锁周期 lock-refresh（防 30 分钟 TTL 被回收）', async () => {
    const { w, deps, opts } = makeWorld();
    w.onTick = (ww) => {
      if (ww.spawned.length && ww.t - DAYTIME > 25 * 60_000) ww.task.status = 'completed';
    };
    await dispatchTask(w.task, deps, opts);
    expect(w.sshCalls.filter((c) => /lock-refresh/.test(c.cmd)).length).toBeGreaterThanOrEqual(2);
  });

  it('被打回 queued 时 PATCH 回 in_progress', async () => {
    const { w, deps, opts } = makeWorld();
    let bounced = false;
    w.onTick = (ww) => {
      if (ww.spawned.length && !bounced && ww.t - DAYTIME > 2 * 60_000) {
        bounced = true;
        ww.task.status = 'queued';
      } else if (bounced && ww.t - DAYTIME > 10 * 60_000) {
        ww.task.status = 'completed';
      }
    };
    await dispatchTask(w.task, deps, opts);
    const inProgress = w.patches.filter((p) => p.status === 'in_progress');
    expect(inProgress.length).toBeGreaterThanOrEqual(2);
    expect(w.task.status).toBe('completed');
  });

  it('会话自己落 failed 后不再转 in_progress、不覆盖终态，并释放仍属自己的锁', async () => {
    const { w, deps, opts } = makeWorld();
    w.onTick = (ww) => {
      if (ww.spawned.length && ww.t - DAYTIME > 2 * 60_000) ww.task.status = 'failed';
    };
    let patchedAfterFail = false;
    const origPatch = deps.brain.patch;
    deps.brain.patch = async (id, body) => {
      if (w.task.status === 'failed') patchedAfterFail = true;
      return origPatch(id, body);
    };
    const r = await dispatchTask(w.task, deps, opts);
    expect(r.outcome).toBe('session_terminal');
    expect(patchedAfterFail).toBe(false);
    expect(w.task.status).toBe('failed');
    expect(w.lockOwner).toBeNull();
  });

  it('会话进程退出、宽限期仍无终态：放锁落 failed', async () => {
    const { w, deps, opts } = makeWorld();
    w.onTick = (ww) => {
      if (ww.spawned.length && ww.t - DAYTIME > 2 * 60_000) {
        ww.agentExited = true;
        ww.agentExitCode = 0;
      }
    };
    const r = await dispatchTask(w.task, deps, opts);
    expect(r.outcome).toBe('failed');
    expect(w.lockOwner).toBeNull();
    expect(lastFailed(w).result.fail_reason).toMatch(/session_exited_without_terminal/);
    expect(w.t - DAYTIME).toBeLessThan(15 * 60_000);
  });

  it('契约非法：claim 后直接落 failed，不碰锁', async () => {
    const { w, deps, opts } = makeWorld({ task: makeTask({ device: { node: 'n', profile: 'bad profile', serial: 's' } }) });
    const r = await dispatchTask(w.task, deps, opts);
    expect(r.outcome).toBe('failed');
    expect(w.sshCalls).toHaveLength(0);
    expect(lastFailed(w).result.fail_reason).toMatch(/invalid_contract/);
  });
});
