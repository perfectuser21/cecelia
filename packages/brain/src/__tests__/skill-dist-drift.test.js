/**
 * skill 分发漂移检测 job + 晨报/日报渲染（链 bf5088a3 棒8，任务 1141f101）
 * 全程注入假执行器：绝不真发 ssh。
 */
import { describe, it, expect, vi } from 'vitest';
import { treeHashOf } from '../lib/skill-manifest.js';
import {
  runSkillDistDrift,
  buildManifestCmd,
  resolveRunners,
  CHECK_INTERVAL_MS,
  EXEC_TIMEOUT_MS,
} from '../skill-dist-drift.js';
import {
  SKILL_DIST_KEY,
  readSkillDistState,
  renderSkillDistLine,
  renderSkillDistSection,
} from '../lib/skill-dist-report.js';

const H = (c) => String(c).repeat(64).slice(0, 64);
const TRUTH = () => ({ a: H('1'), b: H('2'), c: H('3') });

function manifestJson(skills, broken = []) {
  return JSON.stringify({
    version: 1, dir: '/x', host: 'h', count: Object.keys(skills).length, skills, broken,
    tree_hash: treeHashOf(skills),
  });
}

/** 假 working_memory pool */
function fakePool(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    query: vi.fn(async (sql, params = []) => {
      if (/INSERT INTO working_memory/i.test(sql)) { store.set(params[0], JSON.parse(params[1])); return { rows: [] }; }
      if (/FROM working_memory/i.test(sql)) {
        return store.has(params[0]) ? { rows: [{ key: params[0], value_json: store.get(params[0]), updated_at: new Date() }] } : { rows: [] };
      }
      return { rows: [] };
    }),
  };
}

/**
 * 假 exec：按命令里出现的别名 / 目录 token 路由到内存里的「机器」。
 * machines[host][label] = skills 对象 | Error | { raw } | { dirMissing:true }
 */
function fakeExec(machines) {
  const calls = [];
  const exec = vi.fn(async (cmd, opts) => {
    calls.push({ cmd, opts });
    const host = ['xian-m4', 'xian-m1'].find((h) => cmd.includes(h)) ?? 'mmv';
    const label = cmd.includes('codex-gwremote') ? 'codex-gwremote' : 'claude';
    const m = machines[host]?.[label];
    if (m instanceof Error) throw m;
    if (m && m.dirMissing) {
      const e = new Error('Command failed: exit 3');
      e.code = 3; e.stdout = '{"version":1,"error":"dir_missing","dir":"/x"}\n';
      throw e;
    }
    if (m && m.raw !== undefined) return m.raw;
    return manifestJson(m ?? {}, machines[host]?.[`${label}:broken`] ?? []);
  });
  return { exec, calls };
}

const allGood = () => ({
  mmv: { claude: TRUTH() },
  'xian-m4': { claude: TRUTH(), 'codex-gwremote': TRUTH() },
  'xian-m1': { claude: TRUTH(), 'codex-gwremote': TRUTH() },
});

const run = (pool, machines, extra = {}) => {
  const { exec, calls } = fakeExec(machines);
  return runSkillDistDrift(pool, { exec, inContainer: false, scriptText: '#!/bin/bash\necho hi\n', force: true, ...extra })
    .then((r) => ({ r, calls, pool }));
};

const state = (pool) => pool.store.get(SKILL_DIST_KEY);
const machine = (st, id) => st.machines.find((m) => m.id === id);
const dirOf = (st, id, label) => machine(st, id).dirs.find((d) => d.label === label);

describe('漂移检测：改/删/多 一个 skill 会被检出，一致不误报', () => {
  it('全部一致 → ok，无 AMBER 行', async () => {
    const pool = fakePool();
    const { r } = await run(pool, allGood());
    expect(r.checked).toBe(true);
    expect(state(pool).summary).toMatchObject({ drifted: [], unverified: [] });
    expect(dirOf(state(pool), 'xian-m4', 'claude').status).toBe('ok');
    expect(renderSkillDistLine(state(pool))).toBeNull();
  });

  it('改了一个 skill（哈希不同）→ 该机 drift + changed，晨报 AMBER 点名', async () => {
    const pool = fakePool();
    const machines = allGood();
    machines['xian-m4'].claude = { ...TRUTH(), b: H('9') };
    await run(pool, machines);
    const d = dirOf(state(pool), 'xian-m4', 'claude');
    expect(d.status).toBe('drift');
    expect(d.changed).toEqual(['b']);
    expect(state(pool).summary.drifted).toEqual(['xian-m4']);
    const line = renderSkillDistLine(state(pool));
    expect(line).toMatch(/🟡\s*AMBER skill 分发漂移/);
    expect(line).toContain('xian-m4');
    expect(line).toContain('b');
  });

  it('故意在 M1 删掉一个 skill → missing + AMBER（验收 E2E 的 M1 场景）', async () => {
    const pool = fakePool();
    const machines = allGood();
    const { c: _drop, ...rest } = TRUTH();
    machines['xian-m1'].claude = rest;
    await run(pool, machines);
    const d = dirOf(state(pool), 'xian-m1', 'claude');
    expect(d).toMatchObject({ status: 'drift', missing: ['c'] });
    expect(renderSkillDistLine(state(pool))).toMatch(/AMBER[^\n]*xian-m1[^\n]*缺 ?1/);
  });

  it('多余（M4 旧快照残留）→ extra', async () => {
    const pool = fakePool();
    const machines = allGood();
    machines['xian-m4'].claude = { ...TRUTH(), old1: H('7'), old2: H('8') };
    await run(pool, machines);
    expect(dirOf(state(pool), 'xian-m4', 'claude').extra).toEqual(['old1', 'old2']);
  });

  it('跑场机上是悬空链接（cron 无 -L 的病）→ broken 归类为漂移', async () => {
    const pool = fakePool();
    const machines = allGood();
    const { a: _a, ...rest } = TRUTH();
    machines['xian-m1'].claude = rest;
    machines['xian-m1']['claude:broken'] = ['a'];
    await run(pool, machines);
    const d = dirOf(state(pool), 'xian-m1', 'claude');
    expect(d.status).toBe('drift');
    expect(d.broken).toEqual(['a']);
    expect(d.missing).toEqual([]);
  });

  it('codex-gwremote 目录漂移同样检出', async () => {
    const pool = fakePool();
    const machines = allGood();
    machines['xian-m1']['codex-gwremote'] = {};
    await run(pool, machines);
    expect(dirOf(state(pool), 'xian-m1', 'codex-gwremote').status).toBe('drift');
    expect(dirOf(state(pool), 'xian-m1', 'claude').status).toBe('ok');
  });

  it('ssh 通、目录真不存在 → dir_missing 算漂移（不是 unreachable）', async () => {
    const pool = fakePool();
    const machines = allGood();
    machines['xian-m1']['codex-gwremote'] = { dirMissing: true };
    await run(pool, machines);
    expect(dirOf(state(pool), 'xian-m1', 'codex-gwremote').status).toBe('dir_missing');
    expect(state(pool).summary.drifted).toContain('xian-m1');
  });
});

describe('unreachable ≠ 零个 skill（防「探不到=零个=全漂移」的假警）', () => {
  it('ssh 失败 → unreachable，不产生任何 missing，不计入漂移，但晨报仍提示「未核对」', async () => {
    const pool = fakePool();
    const machines = allGood();
    machines['xian-m1'].claude = new Error('ssh: connect to host: Connection refused');
    machines['xian-m1']['codex-gwremote'] = new Error('ssh: connect to host: Connection refused');
    await run(pool, machines);
    const d = dirOf(state(pool), 'xian-m1', 'claude');
    expect(d.status).toBe('unreachable');
    expect(d.missing ?? []).toEqual([]);
    expect(state(pool).summary.drifted).toEqual([]);
    expect(state(pool).summary.unverified).toEqual(['xian-m1']);
    const line = renderSkillDistLine(state(pool));
    expect(line).toMatch(/AMBER/);
    expect(line).toContain('xian-m1');
    expect(line).toMatch(/未核对|不可达/);
    expect(line).not.toMatch(/缺 ?\d/);
  });

  it('exec 超时（killed / SIGTERM）→ unreachable', async () => {
    const pool = fakePool();
    const machines = allGood();
    const e = new Error('Command failed: timed out'); e.killed = true; e.signal = 'SIGTERM';
    machines['xian-m4'].claude = e;
    await run(pool, machines);
    expect(dirOf(state(pool), 'xian-m4', 'claude').status).toBe('unreachable');
  });

  it('输出是垃圾 / 被截断 → invalid（未核对），同样不算零个', async () => {
    const pool = fakePool();
    const machines = allGood();
    machines['xian-m4'].claude = { raw: 'Permission denied\n' };
    const truncated = JSON.parse(manifestJson(TRUTH()));
    delete truncated.skills.c;
    machines['xian-m1'].claude = { raw: JSON.stringify(truncated) };
    await run(pool, machines);
    expect(dirOf(state(pool), 'xian-m4', 'claude').status).toBe('invalid');
    expect(dirOf(state(pool), 'xian-m1', 'claude').status).toBe('invalid');
    expect(state(pool).summary.drifted).toEqual([]);
  });

  it('真身（MMV）取不到 → truth_unavailable，整轮不出逐机 diff，AMBER 提示无法核对', async () => {
    const pool = fakePool();
    const machines = allGood();
    machines.mmv.claude = new Error('ssh: mmv unreachable');
    await run(pool, machines);
    const st = state(pool);
    expect(st.truth.status).toBe('unreachable');
    expect(st.summary.drifted).toEqual([]);
    expect(st.machines.every((m) => m.dirs.every((d) => d.status === 'unchecked'))).toBe(true);
    expect(renderSkillDistLine(st)).toMatch(/AMBER[^\n]*真身/);
  });

  it('真身自己有悬空链接（MMV 实测 29 个）→ 记入 truth.broken 并在日报点名，但不制造逐机漂移、晨报不因此常亮', async () => {
    const pool = fakePool();
    const machines = allGood();
    machines.mmv['claude:broken'] = ['zzz'];
    machines['xian-m1']['claude:broken'] = ['zzz']; // cron 无 -L 也把这个悬空链接拷过去了：同样悬空，不算漂移
    await run(pool, machines);
    expect(state(pool).truth.broken).toEqual(['zzz']);
    expect(state(pool).summary.drifted).toEqual([]);
    expect(renderSkillDistLine(state(pool))).toBeNull();
    expect(renderSkillDistSection(state(pool))).toMatch(/悬空[^\n]*zzz/);
  });
});

describe('调度：自 gate / 命令安全 / 落库', () => {
  it('30min 内不重复采集；超过后再跑；force 忽略 gate', async () => {
    const pool = fakePool();
    const t0 = Date.parse('2026-09-25T10:00:00Z');
    const { exec } = fakeExec(allGood());
    const opts = { exec, inContainer: false, scriptText: 'x', force: false };
    const a = await runSkillDistDrift(pool, { ...opts, now: t0 });
    expect(a.checked).toBe(true);
    const callsAfterFirst = exec.mock.calls.length;
    const b = await runSkillDistDrift(pool, { ...opts, now: t0 + CHECK_INTERVAL_MS - 1000 });
    expect(b).toMatchObject({ skipped: true, reason: 'interval_gate' });
    expect(exec.mock.calls.length).toBe(callsAfterFirst);
    const c = await runSkillDistDrift(pool, { ...opts, now: t0 + CHECK_INTERVAL_MS + 1000 });
    expect(c.checked).toBe(true);
    const d = await runSkillDistDrift(pool, { ...opts, force: true, now: t0 + CHECK_INTERVAL_MS + 2000 });
    expect(d.checked).toBe(true);
  });

  it('每条 ssh 命令都显式带 timeout（execAsync 选项 + ssh ConnectTimeout + BatchMode），不裸跑', async () => {
    const pool = fakePool();
    const { calls } = await run(pool, allGood());
    expect(calls.length).toBe(1 + 2 * 2); // 真身 1 次 + 2 跑场机 × 2 目录
    for (const { cmd, opts } of calls) {
      expect(opts?.timeoutMs).toBe(EXEC_TIMEOUT_MS);
      expect(cmd).toContain('ConnectTimeout=');
      expect(cmd).toContain('BatchMode=yes');
    }
  });

  it('跑场机经 mmv 跳板取（us-vps 只保证有 mmv 别名），真身直连 mmv；命令里不含 IP/用户名', async () => {
    const pool = fakePool();
    const { calls } = await run(pool, allGood());
    const runnerCmd = calls.find((c) => c.cmd.includes('xian-m4')).cmd;
    expect(runnerCmd).toMatch(/ssh [^']*mmv '.*ssh [^']*xian-m4/s);
    for (const { cmd } of calls) {
      expect(cmd).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
      expect(cmd).not.toMatch(/jinnuoshengyuan|xx-macmini/);
    }
  });

  it('容器内运行时经 host-exec 逃逸到宿主再 ssh（同其它采集器）', () => {
    const cmd = buildManifestCmd({ hostAlias: 'xian-m1', dirToken: '@home/.claude/skills', scriptText: 'echo hi', inContainer: true, keyExistsFn: () => false });
    expect(cmd).toContain('host.docker.internal');
    expect(cmd).toContain('xian-m1');
  });

  it('脚本文本 base64 送达：命令行不含原脚本里的单引号（避免多层引号破裂）', () => {
    const cmd = buildManifestCmd({ hostAlias: 'xian-m4', dirToken: '@home/.claude/skills', scriptText: "printf '%s' \"it's\"", inContainer: false });
    expect(cmd).toContain('base64');
    expect(cmd).not.toContain("it's");
  });

  it('SKILL_DRIFT_RUNNERS 只接受安全别名，注入串被拒绝', () => {
    expect(resolveRunners('xian-m4, xian-m1')).toEqual(['xian-m4', 'xian-m1']);
    expect(resolveRunners(undefined)).toEqual(['xian-m4', 'xian-m1']);
    expect(() => resolveRunners('xian-m4;rm -rf /')).toThrow(/别名/);
    expect(() => resolveRunners('$(id)')).toThrow(/别名/);
  });

  it('结果落 working_memory.skill_manifest_drift，含 checked_at 与真身摘要', async () => {
    const pool = fakePool();
    await run(pool, allGood(), { now: Date.parse('2026-09-25T10:00:00Z') });
    const st = state(pool);
    expect(st.checked_at).toBe('2026-09-25T10:00:00.000Z');
    expect(st.truth).toMatchObject({ status: 'ok', count: 3 });
    expect(st.truth.tree_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('列表落库有上限（防一台机器全漂移时把 working_memory 撑大）', async () => {
    const pool = fakePool();
    const big = {}; for (let i = 0; i < 200; i++) big[`s${String(i).padStart(3, '0')}`] = H(i % 10);
    const machines = allGood();
    machines.mmv.claude = big;
    machines['xian-m4'].claude = {};
    await run(pool, machines);
    const d = dirOf(state(pool), 'xian-m4', 'claude');
    expect(d.missing.length).toBeLessThanOrEqual(30);
    expect(d.missing_total).toBe(200);
  });
});

describe('渲染：晨报一行 / 日报板块', () => {
  const okState = (over = {}) => ({
    checked_at: new Date().toISOString(),
    truth: { status: 'ok', count: 3, tree_hash: H('a'), broken: [] },
    machines: [{ id: 'xian-m4', dirs: [{ label: 'claude', status: 'ok' }] }],
    summary: { drifted: [], unverified: [], ok: ['xian-m4'] },
    ...over,
  });

  it('无数据（job 从未跑）→ 不出行不出板块', () => {
    expect(renderSkillDistLine(null)).toBeNull();
    expect(renderSkillDistSection(null)).toBe('');
  });

  it('一致：日报出板块但不含 AMBER；晨报无行', () => {
    const s = okState();
    expect(renderSkillDistLine(s)).toBeNull();
    const sec = renderSkillDistSection(s);
    expect(sec).toContain('== skill 分发漂移 ==');
    expect(sec).not.toMatch(/AMBER/);
  });

  it('数据超过 6h 未刷新 → AMBER「检测已过期」（检测本身停了也要响）', () => {
    const s = okState({ checked_at: new Date(Date.now() - 7 * 3600 * 1000).toISOString() });
    expect(renderSkillDistLine(s)).toMatch(/AMBER[^\n]*(过期|未更新)/);
  });

  it('日报板块逐机逐目录列出缺/多/异，点名 skill', () => {
    const s = okState({
      machines: [{ id: 'xian-m4', dirs: [{ label: 'claude', status: 'drift', missing: ['a'], missing_total: 1, extra: ['old'], extra_total: 1, changed: ['b'], changed_total: 1, broken: [], broken_total: 0 }] }],
      summary: { drifted: ['xian-m4'], unverified: [], ok: [] },
    });
    const sec = renderSkillDistSection(s);
    expect(sec).toMatch(/🟡 AMBER/);
    expect(sec).toContain('xian-m4');
    expect(sec).toMatch(/缺[^\n]*a/);
    expect(sec).toMatch(/多[^\n]*old/);
    expect(sec).toMatch(/异[^\n]*b/);
  });

  it('readSkillDistState：读 working_memory，缺失/查询失败返回 null（best-effort）', async () => {
    const s = okState();
    expect(await readSkillDistState(fakePool({ [SKILL_DIST_KEY]: s }))).toMatchObject({ truth: { count: 3 } });
    expect(await readSkillDistState(fakePool())).toBeNull();
    expect(await readSkillDistState({ query: async () => { throw new Error('db down'); } })).toBeNull();
  });
});
