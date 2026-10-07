import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSprintDir, buildResult } from '../lib/protocol.mjs';

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
