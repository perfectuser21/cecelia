import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSprintDir, buildResult, fail, validateBase, childEnv } from '../lib/protocol.mjs';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/activity-fixture.mjs');

function runFixture(mode, input) {
  const r = spawnSync(process.execPath, [FIXTURE, mode], { input: JSON.stringify(input), encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('buildResult', () => {
  it('completed 时 failure_class 为 null，并补齐默认字段', () => {
    expect(buildResult({ run_tag: 'r1' }, { status: 'completed' })).toEqual({
      schema_version: 1,
      run_tag: 'r1',
      status: 'completed',
      failure_class: null,
      outputs: {},
      metrics: {},
      evidence: [],
    });
  });

  it('completed 即使传了 failure_class 也强制为 null', () => {
    expect(buildResult({ run_tag: 'r1' }, { status: 'completed', failure_class: 'fatal' }).failure_class).toBeNull();
  });

  it('outputs 含非法 key 降级为 failed/fatal', () => {
    const r = buildResult({ run_tag: 'r1' }, { status: 'completed', outputs: { 'bad-key': 1 } });
    expect(r.status).toBe('failed');
    expect(r.failure_class).toBe('fatal');
    expect(r.reason_code).toBe('outputs_key_invalid:bad-key');
  });

  it('非 completed 缺 failure_class 默认 fatal', () => {
    expect(buildResult({ run_tag: 'r1' }, { status: 'failed' }).failure_class).toBe('fatal');
    expect(buildResult({ run_tag: 'r1' }, { status: 'partial' }).failure_class).toBe('fatal');
  });

  it('保留合法 failure_class', () => {
    expect(buildResult({ run_tag: 'r1' }, { status: 'failed', failure_class: 'retryable' }).failure_class).toBe('retryable');
  });

  it('run_tag 原样回传，缺失/输入为 null 时为 null', () => {
    expect(buildResult({ run_tag: 'abc-1' }, { status: 'completed' }).run_tag).toBe('abc-1');
    expect(buildResult({}, { status: 'completed' }).run_tag).toBeNull();
    expect(buildResult(null, { status: 'completed' }).run_tag).toBeNull();
  });

  it.each([
    ['outputs 为数组', { outputs: [] }],
    ['outputs 为字符串', { outputs: 'x' }],
    ['metrics 为数组', { metrics: [1] }],
    ['metrics 为 null', { metrics: null }],
    ['evidence 为对象', { evidence: {} }],
    ['evidence 为字符串', { evidence: 'x' }],
  ])('%s 降级 failed/fatal，reason_code 为 result_payload_invalid', (_name, patch) => {
    const r = buildResult({ run_tag: 'r1' }, { status: 'completed', ...patch });
    expect(r.status).toBe('failed');
    expect(r.failure_class).toBe('fatal');
    expect(r.reason_code).toBe('result_payload_invalid');
    expect(r.outputs).toEqual({});
    expect(r.metrics).toEqual({});
    expect(r.evidence).toEqual([]);
  });
});

describe('runActivity（子进程）', () => {
  it('completed：stdout 恰好一个 JSON 对象，退出码 0', () => {
    const r = runFixture('ok', { run_tag: 'rt-ok' });
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    const out = JSON.parse(lines[0]);
    expect(out).toEqual({
      schema_version: 1,
      run_tag: 'rt-ok',
      status: 'completed',
      failure_class: null,
      outputs: { echoed: 'rt-ok' },
      metrics: { n: 1 },
      evidence: ['e1'],
    });
  });

  it('handler throw：退出码 2，failed/fatal，reason_code 为错误信息', () => {
    const r = runFixture('throw', { run_tag: 'rt-throw' });
    expect(r.status).toBe(2);
    const out = JSON.parse(r.stdout);
    expect(out.status).toBe('failed');
    expect(out.failure_class).toBe('fatal');
    expect(out.reason_code).toBe('boom_reason');
    expect(out.run_tag).toBe('rt-throw');
  });

  it('handler 里 console.log 不污染 stdout，噪音进 stderr', () => {
    const r = runFixture('noise', { run_tag: 'rt-noise' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(r.stdout).status).toBe('completed');
    expect(r.stderr).toContain('noise');
  });

  it('stdin 非法 JSON：退出码 2，run_tag 为 null', () => {
    const r = spawnSync(process.execPath, [FIXTURE, 'ok'], { input: 'not json', encoding: 'utf8' });
    expect(r.status).toBe(2);
    const out = JSON.parse(r.stdout);
    expect(out.status).toBe('failed');
    expect(out.run_tag).toBeNull();
  });
});

describe('resolveSprintDir', () => {
  it('相对路径拼到 worktree 下', () => {
    expect(resolveSprintDir('/w', 'sprints/a')).toBe('/w/sprints/a');
  });

  it.each(['../x', '/abs', 'a/../../b', '.', './', '', 'sprints/..', './.', './/'])('非法 sprintDir %s 抛 sprint_dir_invalid', (bad) => {
    expect(() => resolveSprintDir('/w', bad)).toThrow('sprint_dir_invalid');
  });

  it.each(['', 'relative/wt', undefined, null, 42])('非法 worktree %s 抛 sprint_dir_invalid', (bad) => {
    expect(() => resolveSprintDir(bad, 'sprints/a')).toThrow('sprint_dir_invalid');
  });
});

describe('fail', () => {
  it('生成 failed 结果，带 failure_class 与 reason_code', () => {
    expect(fail('fatal', 'x_code')).toEqual({ status: 'failed', failure_class: 'fatal', reason_code: 'x_code' });
  });

  it('extra 合并进结果（如 evidence）', () => {
    expect(fail('retryable', 'y', { evidence: [{ a: 1 }] })).toEqual({
      status: 'failed',
      failure_class: 'retryable',
      reason_code: 'y',
      evidence: [{ a: 1 }],
    });
  });
});

describe('validateBase', () => {
  const ok = { task_id: 't-1', worktree: '/w', sprint_dir: 'sprints/a' };

  it('合法输入返回 { dir }', () => {
    expect(validateBase(ok)).toEqual({ dir: '/w/sprints/a' });
  });

  it.each([undefined, '', 5, null])('task_id=%s 抛 task_id_missing', (bad) => {
    expect(() => validateBase({ ...ok, task_id: bad })).toThrow('task_id_missing');
  });

  it('task_id 与 sprint_dir 同时非法时先报 task_id_missing', () => {
    expect(() => validateBase({ ...ok, task_id: '', sprint_dir: '../x' })).toThrow('task_id_missing');
  });

  it.each([
    ['sprint_dir 含 ..', { sprint_dir: '../x' }],
    ['worktree 相对路径', { worktree: 'rel/wt' }],
    ['worktree 缺失', { worktree: undefined }],
  ])('%s 抛 sprint_dir_invalid', (_name, patch) => {
    expect(() => validateBase({ ...ok, ...patch })).toThrow('sprint_dir_invalid');
  });

  it('input 为 null 时抛 task_id_missing', () => {
    expect(() => validateBase(null)).toThrow('task_id_missing');
  });
});

describe('childEnv', () => {
  const base = {
    PATH: '/bin',
    GIT_DIR: '/x/.git',
    GIT_WORK_TREE: '/x',
    GIT_INDEX_FILE: '/x/.git/index',
    GIT_AUTHOR_NAME: 'keep',
    CLAUDECODE: '1',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CONFIG_DIR: '/keep',
  };

  it('默认剥离 GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE，保留其余', () => {
    const env = childEnv(base);
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_WORK_TREE).toBeUndefined();
    expect(env.GIT_INDEX_FILE).toBeUndefined();
    expect(env.PATH).toBe('/bin');
    expect(env.GIT_AUTHOR_NAME).toBe('keep');
    expect(env.CLAUDECODE).toBe('1');
  });

  it('stripClaude 额外剥离 CLAUDECODE 与 CLAUDE_CODE_* ，保留 CLAUDE_CONFIG_DIR', () => {
    const env = childEnv(base, { stripClaude: true });
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(env.CLAUDE_CONFIG_DIR).toBe('/keep');
    expect(env.GIT_DIR).toBeUndefined();
  });

  it('CODING_WF_* 一律保留（runner→执行器→活动要读 CODING_WF_GH_BIN、超时等；只在 claude 会话 env 里剥）', () => {
    const withRunner = { ...base, CODING_WF_REPO: '/clone', CODING_WF_GH_BIN: '/gh' };
    expect(childEnv(withRunner, { stripClaude: true }).CODING_WF_GH_BIN).toBe('/gh');
    expect(childEnv(withRunner).CODING_WF_REPO).toBe('/clone');
  });

  it('不修改传入对象', () => {
    childEnv(base, { stripClaude: true });
    expect(base.GIT_DIR).toBe('/x/.git');
    expect(base.CLAUDECODE).toBe('1');
  });
});
