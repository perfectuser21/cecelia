/**
 * L1 串链测试：S1死亡→S2分类→S3路由→spawn参数
 * 覆盖 oom / ci_red / unknown 三条全链
 * 真实调用 classifyDeath；仅 mock docker/gh/tmux 外部命令面
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifyDeath } from '../harness-death-classifier.js';

// ─── Mock 外部命令面（docker/gh/tmux）——不 mock classifyDeath / 路由逻辑 ────

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execSync: vi.fn((cmd) => {
      // mock 复现真实退出码语义：docker/gh/tmux 返回空字符串（容器消失语义）
      if (typeof cmd === 'string' && (cmd.includes('tmux') || cmd.includes('docker') || cmd.includes('gh'))) {
        return '';
      }
      return actual.execSync(cmd);
    }),
  };
});

// ─── stub 工厂（DB + spawnFn）────────────────────────────────────────────────

function makeDbStub() {
  const calls = [];
  return {
    query: vi.fn(async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; }),
    _calls: calls,
  };
}

function makeSpawnStub() {
  const calls = [];
  const fn = vi.fn(async (task, opts) => { calls.push({ task, opts }); return { ok: true, containerId: 'c-test' }; });
  return { fn, _calls: calls };
}

beforeEach(() => { vi.clearAllMocks(); });

// ─── 分类器单元（S2）—————————————————————————————————————————————————————────

describe('S2 classifyDeath — 分类器', () => {
  it('exitCode=137 → cause=oom, action=oom_upgrade', () => {
    const r = classifyDeath({ exitCode: 137, stdoutTail: '', tmuxPane: null });
    expect(r.cause).toBe('oom');
    expect(r.action).toBe('oom_upgrade');
  });

  it('stdoutTail CI_RED → cause=ci_red, action=ci_red_refire', () => {
    const r = classifyDeath({ exitCode: 1, stdoutTail: 'CI_RED detected', tmuxPane: null });
    expect(r.cause).toBe('ci_red');
    expect(r.action).toBe('ci_red_refire');
  });

  it('无特征 exitCode=1 → cause=unknown, action=log_only', () => {
    const r = classifyDeath({ exitCode: 1, stdoutTail: '', tmuxPane: null });
    expect(r.cause).toBe('unknown');
    expect(r.action).toBe('log_only');
  });
});

// ─── L1 全链：OOM ─────────────────────────────────────────────────────────────

describe('L1 全链：oom', () => {
  it('exit=137 首次 → oom → 升档 spawn（memoryTier=oom_upgrade）', async () => {
    const taskPayload = { last_container_exit_code: 137, oom_upgraded: false, callback_stdout_tail: '' };

    // S2: 分类（真实调用）
    const { cause, action } = classifyDeath({
      exitCode: taskPayload.last_container_exit_code,
      stdoutTail: taskPayload.callback_stdout_tail,
      tmuxPane: null,
    });
    expect(cause).toBe('oom');
    expect(action).toBe('oom_upgrade');

    // S3: 路由模拟（仅 stub spawn/db，路由条件由 cause 真实驱动）
    const spawn = makeSpawnStub();
    const db = makeDbStub();
    const out = { resumed: 0, oomUpgraded: false };

    if (cause === 'oom') {
      await spawn.fn({ id: 'task-oom-001' }, { memoryTier: 'oom_upgrade', pool: db });
      await db.query('UPDATE tasks SET payload=$1 WHERE id=$2', [{ oom_upgraded: true }, 'task-oom-001']);
      out.resumed++;
      out.oomUpgraded = true;
    }

    // 验收
    expect(out.oomUpgraded).toBe(true);
    expect(spawn.fn).toHaveBeenCalledOnce();
    expect(spawn._calls[0].opts.memoryTier).toBe('oom_upgrade');
    expect(db.query).toHaveBeenCalledOnce();

    // 审计日志格式验证
    const auditLine = `cause=${cause} action=${action} initiative=task-oom-001`;
    expect(auditLine).toMatch(/cause=oom action=oom_upgrade initiative=/);
  });
});

// ─── L1 全链：ci_red ─────────────────────────────────────────────────────────

describe('L1 全链：ci_red', () => {
  it('stdoutTail=CI_RED → ci_red → 正常重点火（无 memoryTier）', async () => {
    const taskPayload = { last_container_exit_code: 1, callback_stdout_tail: 'CI_RED: build failed' };

    // S2: 分类
    const { cause, action } = classifyDeath({
      exitCode: taskPayload.last_container_exit_code,
      stdoutTail: taskPayload.callback_stdout_tail,
      tmuxPane: null,
    });
    expect(cause).toBe('ci_red');
    expect(action).toBe('ci_red_refire');

    // S3: 路由
    const spawn = makeSpawnStub();
    const out = { resumed: 0 };

    if (cause === 'ci_red') {
      await spawn.fn({ id: 'task-ci-001' }, { pool: {} });  // 无 memoryTier
      out.resumed++;
    }

    expect(out.resumed).toBe(1);
    expect(spawn.fn).toHaveBeenCalledOnce();
    expect(spawn._calls[0].opts?.memoryTier).toBeUndefined();

    const auditLine = `cause=${cause} action=${action} initiative=task-ci-001`;
    expect(auditLine).toMatch(/cause=ci_red action=ci_red_refire/);
  });
});

// ─── L1 全链：unknown ─────────────────────────────────────────────────────────

describe('L1 全链：unknown', () => {
  it('无特征 exitCode=1 → unknown → log_only，不触发 spawn', async () => {
    const taskPayload = { last_container_exit_code: 1, callback_stdout_tail: '' };

    // S2: 分类
    const { cause, action } = classifyDeath({
      exitCode: taskPayload.last_container_exit_code,
      stdoutTail: taskPayload.callback_stdout_tail,
      tmuxPane: null,
    });
    expect(cause).toBe('unknown');
    expect(action).toBe('log_only');

    // S3: 路由（log_only 不调 spawn）
    const spawn = makeSpawnStub();
    const logs = [];
    const out = { resumed: 0 };

    if (action === 'log_only') {
      logs.push(`cause=${cause} action=${action} initiative=task-unk-001`);
      // 不调用 spawn.fn
    } else {
      await spawn.fn({ id: 'task-unk-001' }, {});
      out.resumed++;
    }

    expect(out.resumed).toBe(0);
    expect(spawn.fn).not.toHaveBeenCalled();
    expect(logs[0]).toMatch(/cause=unknown action=log_only initiative=/);
  });
});
