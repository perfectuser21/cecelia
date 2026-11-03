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
    task_type: 'skill_factory_run',
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

// 回归（上产实测 2026-10-11）：claim 带 executor_kind='factory-dispatcher' 违反 tasks_executor_kind_check，Brain 回 500，
// 推进器建出的执行单永远认领不了。必须用已登记的 openclaw-agent（派给 OpenClaw skill-factory agent 执行）。
describe('Brain 客户端 claim 的 executor_kind', () => {
  it('claim 请求体 executor_kind=openclaw-agent（tasks_executor_kind_check 允许值）', async () => {
    const mod = await import('../factory-dispatcher.js');
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { status: 200, text: async () => '{}' }; };
    try {
      await mod.makeBrainClient('http://brain').claim('t1', 'factory-dispatcher@mmv');
    } finally { globalThis.fetch = realFetch; }
    expect(calls[0].url).toBe('http://brain/api/brain/tasks/t1/claim');
    expect(JSON.parse(calls[0].init.body)).toEqual({ claimer: 'factory-dispatcher@mmv', executor_kind: 'openclaw-agent' });
  });
});

// 统一领单租约（派发总闸 G，任务 c5f6e683）：claim 带 lease_seconds，守望每轮心跳续约；
// 心跳 409 lease_lost = Brain 已按租约回收（回队或判 lost）→ 派发器停手：杀会话、放自己的锁、不再回写任务。
describe('统一领单租约 + 心跳', () => {
  function withLease(world, { lostAfterMs = null } = {}) {
    const { w, deps } = world;
    w.claimArgs = [];
    w.heartbeats = 0;
    deps.brain.claim = async (id, claimer, leaseSeconds) => {
      w.claims.push(id);
      w.claimArgs.push({ claimer, leaseSeconds });
      return { status: 200 };
    };
    deps.brain.heartbeat = async () => {
      w.heartbeats += 1;
      return { status: lostAfterMs !== null && w.t - DAYTIME >= lostAfterMs ? 409 : 200 };
    };
    return world;
  }

  it('Brain 客户端：claim 带 lease_seconds，heartbeat POST /tasks/:id/heartbeat', async () => {
    const mod = await import('../factory-dispatcher.js');
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { status: 200, text: async () => '{}' }; };
    try {
      const c = mod.makeBrainClient('http://brain');
      await c.claim('t1', 'fd@mmv', 600);
      await c.heartbeat('t1', 'fd@mmv', 600);
    } finally { globalThis.fetch = realFetch; }
    expect(JSON.parse(calls[0].init.body)).toEqual({ claimer: 'fd@mmv', executor_kind: 'openclaw-agent', lease_seconds: 600 });
    expect(calls[1].url).toBe('http://brain/api/brain/tasks/t1/heartbeat');
    expect(JSON.parse(calls[1].init.body)).toEqual({ claimer: 'fd@mmv', lease_seconds: 600 });
  });

  it('默认租约 600 秒', async () => {
    const mod = await import('../factory-dispatcher.js');
    expect(mod.DEFAULT_OPTS.leaseSeconds).toBe(600);
  });
});
