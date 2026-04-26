/**
 * docker-executor-skill-missing.test.js
 *
 * 锚定 04-25 串成 325 个 liveness_dead 的根因防回归：
 *   worker 接 `/dev <PRD>` 但镜像里没装 dev skill →
 *   claude 输出 "Unknown skill: dev. Did you mean new?" + end_turn (exit_code=0) →
 *   writeDockerCallback 旧逻辑当成 success → task 留 queued + watchdog 反复 requeue →
 *   同一故障循环到 quarantine。
 *
 * 修法：writeDockerCallback 在入库前扫 stdout，命中 "Unknown skill:" 把 status
 * 降级 'failed' + failure_class='env_skill_missing' + _meta.skill_missing=<name>，
 * 让下游 dev-failure-classifier ENV_BROKEN 路径标 retryable=false。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...a) => queryMock(...a) } }));

// harness-graph 的 parseDockerOutput / extractField 是纯解析器，stub 成简单实现避免依赖链
vi.mock('../harness-graph.js', () => ({
  parseDockerOutput: () => null,
  extractField: () => null,
}));

const { writeDockerCallback } = await import('../docker-executor.js');

const baseTask = { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', task_type: 'dev' };

function makeResult(stdout, overrides = {}) {
  return {
    container: 'cecelia-task-test',
    container_id: 'abc123',
    started_at: '2026-04-26T09:02:19.068Z',
    ended_at: '2026-04-26T09:03:00.734Z',
    timed_out: false,
    exit_code: 0,
    stdout,
    stderr: '',
    duration_ms: 41345,
    ...overrides,
  };
}

function lastInsertArgs() {
  expect(queryMock).toHaveBeenCalled();
  const args = queryMock.mock.calls[queryMock.mock.calls.length - 1][1];
  // execution.js 写法：[task_id, checkpoint_id, run_id, status, result_json, stderr_tail, duration_ms, attempt, exit_code, failure_class]
  return {
    status: args[3],
    resultJson: JSON.parse(args[4]),
    failureClass: args[9],
  };
}

describe('writeDockerCallback — Unknown skill 检测（防回归 04-25 死循环）', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [] });
  });

  it('exit_code=0 + stdout 含 "Unknown skill: dev" → status=failed + failure_class=env_skill_missing', async () => {
    const stdout = '{"type":"result","subtype":"success","is_error":false,"result":"`/dev` skill 在当前环境未注册（系统提示 \\"Unknown skill: dev\\"），所以无法直接调用","stop_reason":"end_turn"}';
    await writeDockerCallback(baseTask, 'run-1', null, makeResult(stdout));
    const { status, failureClass, resultJson } = lastInsertArgs();
    expect(status).toBe('failed');
    expect(failureClass).toBe('env_skill_missing');
    expect(resultJson._meta.env_broken_reason).toBe('unknown_skill');
    expect(resultJson._meta.skill_missing).toBe('dev');
  });

  it('exit_code=0 + 干净 stdout → status=success（保持原行为）', async () => {
    await writeDockerCallback(baseTask, 'run-1', null, makeResult('{"type":"result","result":"PR ready: https://github.com/x/y/pull/1"}'));
    const { status, failureClass, resultJson } = lastInsertArgs();
    expect(status).toBe('success');
    expect(failureClass).toBeNull();
    expect(resultJson._meta.skill_missing).toBeUndefined();
    expect(resultJson._meta.env_broken_reason).toBeUndefined();
  });

  it('exit_code≠0 + stdout 含 "Unknown skill" → status=failed + env_skill_missing 优先于 docker_nonzero_exit', async () => {
    const stdout = 'Unknown skill: harness_run. Did you mean run?';
    await writeDockerCallback(baseTask, 'run-1', null, makeResult(stdout, { exit_code: 1 }));
    const { status, failureClass, resultJson } = lastInsertArgs();
    expect(status).toBe('failed');
    expect(failureClass).toBe('env_skill_missing');
    expect(resultJson._meta.skill_missing).toBe('harness_run');
  });

  it('timed_out=true 时不被 env_skill_missing 覆盖（timeout 优先，环境问题次要）', async () => {
    const stdout = 'Unknown skill: dev';
    await writeDockerCallback(baseTask, 'run-1', null, makeResult(stdout, { timed_out: true, exit_code: 137 }));
    const { status, failureClass } = lastInsertArgs();
    expect(status).toBe('timeout');
    expect(failureClass).toBe('docker_timeout');
  });

  it('skill 名带 word 字符 + 连字符（dev / harness_run / pipeline-fix）都能正确提取', async () => {
    for (const name of ['dev', 'harness_run', 'pipeline-fix']) {
      queryMock.mockReset();
      queryMock.mockResolvedValue({ rows: [] });
      await writeDockerCallback(baseTask, 'run-1', null, makeResult(`Unknown skill: ${name}. Did you mean foo?`));
      expect(lastInsertArgs().resultJson._meta.skill_missing).toBe(name);
    }
  });

  it('空 stdout / null stdout → 不命中 env_broken（保持原 success/failed 行为）', async () => {
    await writeDockerCallback(baseTask, 'run-1', null, makeResult(''));
    expect(lastInsertArgs().status).toBe('success');
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [] });
    await writeDockerCallback(baseTask, 'run-1', null, makeResult(null));
    expect(lastInsertArgs().status).toBe('success');
  });
});
