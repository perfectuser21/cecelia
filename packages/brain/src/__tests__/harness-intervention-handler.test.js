/**
 * harness-intervention-handler.test.js
 * WS5 — Intervention Handler 单元测试
 *
 * 覆盖：Docker logs 读取、LLM action 解析、handleIntervention 全分支降级逻辑、
 * 以及 task-router 的 handler 注册。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  INTERVENTION_ACTIONS,
  readDockerLogs,
  readKernelAttemptEvidence,
  parseInterventionAction,
  handleIntervention,
} from '../harness-intervention-handler.js';
import { getInternalTaskHandler, INTERNAL_TASK_HANDLERS } from '../task-router.js';

describe('INTERVENTION_ACTIONS 枚举', () => {
  it('包含 retry / skip / alert 三个动作', () => {
    expect(INTERVENTION_ACTIONS).toEqual(expect.arrayContaining(['retry', 'skip', 'alert']));
  });
});

describe('parseInterventionAction', () => {
  it('识别明确的 ACTION: 标记（半角冒号）', () => {
    expect(parseInterventionAction('ACTION: retry 因为是网络超时')).toBe('retry');
  });

  it('识别全角冒号 action：skip', () => {
    expect(parseInterventionAction('action：skip 该步骤可跳过')).toBe('skip');
  });

  it('无标记时回退到裸词匹配', () => {
    expect(parseInterventionAction('I think we should retry this')).toBe('retry');
  });

  it('无法识别的文本降级为 alert', () => {
    expect(parseInterventionAction('完全不相关的输出')).toBe('alert');
  });

  it('空值/非字符串降级为 alert', () => {
    expect(parseInterventionAction(null)).toBe('alert');
    expect(parseInterventionAction('')).toBe('alert');
    expect(parseInterventionAction(123)).toBe('alert');
  });
});

describe('readDockerLogs', () => {
  it('成功时合并 stdout + stderr 并去除首尾空白', async () => {
    const fakeExec = vi.fn((cmd, args, opts, cb) => {
      expect(cmd).toBe('docker');
      expect(args[0]).toBe('logs');
      cb(null, 'line1\nline2\n', 'err-line\n');
    });
    const out = await readDockerLogs('abc123', { execFile: fakeExec, tail: 50 });
    expect(out).toBe('line1\nline2\nerr-line');
    expect(fakeExec).toHaveBeenCalledTimes(1);
    // tail 参数透传
    expect(fakeExec.mock.calls[0][1]).toContain('50');
    expect(fakeExec.mock.calls[0][1]).toContain('abc123');
  });

  it('execFile 报错时 reject', async () => {
    const fakeExec = vi.fn((cmd, args, opts, cb) => cb(new Error('no such container')));
    await expect(readDockerLogs('missing', { execFile: fakeExec })).rejects.toThrow('no such container');
  });
});

describe('readKernelAttemptEvidence', () => {
  it('只按 run_id 读取 harness_attempts 的 result/receipt/telemetry 白名单', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        id: 'attempt-18',
        hop: 18,
        phase: 'contract',
        role: 'reviewer',
        status: 'running',
        heartbeat_at: '2026-07-28T04:00:00.000Z',
        error_message: 'provider failed: Bearer should-not-leak',
        result: { decision: { outcome: 'REVISION' }, token: 'must-not-leak' },
        result_receipt_id: null,
      }],
    });

    const evidence = await readKernelAttemptEvidence('run-kernel-1', { pool: { query } });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('FROM harness_attempts');
    expect(query.mock.calls[0][0]).toContain('result');
    expect(query.mock.calls[0][0]).toContain('heartbeat_at');
    expect(query.mock.calls[0][0]).toContain('result_receipt_id');
    expect(query.mock.calls[0][1]).toEqual(['run-kernel-1']);
    expect(evidence).toContain('"source":"harness_attempts"');
    expect(evidence).toContain('"role":"reviewer"');
    expect(evidence).toContain('"token":"[REDACTED]"');
    expect(evidence).not.toContain('must-not-leak');
    expect(evidence).toContain('Bearer [REDACTED]');
    expect(evidence).not.toContain('should-not-leak');
  });
});

describe('handleIntervention', () => {
  const baseTask = { id: 'task-1', title: 'pipeline 卡住', payload: { container_id: 'c1' } };

  it('无 container_id → alert，不分析', async () => {
    const updates = [];
    const res = await handleIntervention(
      { id: 't', title: 'x', payload: {} },
      { updateTaskResult: (id, r) => updates.push([id, r]) }
    );
    expect(res.action).toBe('alert');
    expect(res.analyzed).toBe(false);
    expect(res.reason).toBe('no_container_id');
    expect(updates).toHaveLength(1);
    expect(updates[0][1].action).toBe('alert');
  });

  it('日志读取成功 + LLM 判 retry → retry，已分析', async () => {
    const res = await handleIntervention(baseTask, {
      readLogs: async () => 'ETIMEDOUT fetching registry',
      callLLM: async () => ({ text: 'ACTION: retry 网络瞬态错误' }),
    });
    expect(res.action).toBe('retry');
    expect(res.analyzed).toBe(true);
    expect(res.reason).toContain('retry');
  });

  it('LLM 判 skip → skip', async () => {
    const res = await handleIntervention(baseTask, {
      readLogs: async () => '某非关键步骤失败',
      callLLM: async () => ({ text: 'ACTION: skip 不影响交付' }),
    });
    expect(res.action).toBe('skip');
  });

  it('docker logs 读取失败 → alert (docker_logs_failed)', async () => {
    const res = await handleIntervention(baseTask, {
      readLogs: async () => { throw new Error('daemon down'); },
      callLLM: async () => ({ text: 'ACTION: retry' }),
    });
    expect(res.action).toBe('alert');
    expect(res.analyzed).toBe(false);
    expect(res.reason).toContain('docker_logs_failed');
  });

  it('日志为空 → alert (empty_logs)', async () => {
    const res = await handleIntervention(baseTask, {
      readLogs: async () => '   ',
      callLLM: async () => ({ text: 'ACTION: retry' }),
    });
    expect(res.action).toBe('alert');
    expect(res.reason).toBe('empty_logs');
  });

  it('LLM 抛异常 → alert (handler_error)，不抛出', async () => {
    const res = await handleIntervention(baseTask, {
      readLogs: async () => 'some logs',
      callLLM: async () => { throw new Error('llm exploded'); },
    });
    expect(res.action).toBe('alert');
    expect(res.reason).toContain('handler_error');
  });

  it('updateTaskResult 抛异常时不影响返回值', async () => {
    const res = await handleIntervention(baseTask, {
      readLogs: async () => 'logs',
      callLLM: async () => ({ text: 'ACTION: alert 需人工' }),
      updateTaskResult: async () => { throw new Error('db down'); },
    });
    expect(res.action).toBe('alert');
  });

  it('task 为空也不抛错', async () => {
    const res = await handleIntervention(null, {});
    expect(res.action).toBe('alert');
  });

  it('kernel-v1 只读 Attempt evidence，绝不调用 docker logs', async () => {
    const readLogs = vi.fn(async () => 'wrong execution body');
    const readKernelEvidence = vi.fn(async () => (
      '{"source":"harness_attempts","attempts":[{"role":"reviewer","status":"running"}]}'
    ));
    const llm = vi.fn(async (_kind, prompt) => {
      expect(prompt).toContain('Kernel Attempt evidence');
      expect(prompt).toContain('harness_attempts');
      expect(prompt).not.toContain('Docker 日志');
      return { text: 'ACTION: retry lease still fresh' };
    });
    const task = {
      id: 'kernel-intervention',
      title: 'Kernel reviewer stuck',
      payload: {
        harness_runtime: 'kernel-v1',
        run_id: 'run-kernel-1',
        container_id: 'misleading-relay-container',
      },
    };

    const res = await handleIntervention(task, {
      readLogs,
      readKernelEvidence,
      callLLM: llm,
    });

    expect(res).toMatchObject({ action: 'retry', analyzed: true, evidence_source: 'harness_attempts' });
    expect(readKernelEvidence).toHaveBeenCalledWith('run-kernel-1', expect.any(Object));
    expect(readLogs).not.toHaveBeenCalled();
  });

  it('kernel-v1 缺 run_id 时 fail-closed，且不回落 docker', async () => {
    const readLogs = vi.fn(async () => 'relay logs');
    const res = await handleIntervention({
      id: 'kernel-no-run',
      payload: { harness_runtime: 'kernel-v1', container_id: 'relay-1' },
    }, {
      readLogs,
      callLLM: async () => ({ text: 'ACTION: alert must not be reached' }),
    });

    expect(res).toMatchObject({
      action: 'alert',
      analyzed: false,
      reason: 'kernel_run_id_missing',
      evidence_source: 'harness_attempts',
    });
    expect(readLogs).not.toHaveBeenCalled();
  });

  it('kernel Attempt evidence 读取失败时 alert，不回落 docker', async () => {
    const readLogs = vi.fn(async () => 'relay logs');
    const res = await handleIntervention({
      id: 'kernel-db-failure',
      payload: { harness_runtime: 'kernel-v1', run_id: 'run-kernel-2', container_id: 'relay-2' },
    }, {
      readLogs,
      readKernelEvidence: async () => { throw new Error('postgres down'); },
      callLLM: async () => ({ text: 'ACTION: alert must not be reached' }),
    });

    expect(res.action).toBe('alert');
    expect(res.analyzed).toBe(false);
    expect(res.reason).toContain('kernel_evidence_failed');
    expect(res.evidence_source).toBe('harness_attempts');
    expect(readLogs).not.toHaveBeenCalled();
  });

  it('旧 relay 保持 Docker logs 路径并标记 evidence_source', async () => {
    const readLogs = vi.fn(async () => 'legacy relay output');
    const readKernelEvidence = vi.fn();
    const res = await handleIntervention(baseTask, {
      readLogs,
      readKernelEvidence,
      callLLM: async () => ({ text: 'ACTION: alert inspect relay' }),
    });

    expect(res.evidence_source).toBe('docker_logs');
    expect(readLogs).toHaveBeenCalledWith('c1', expect.any(Object));
    expect(readKernelEvidence).not.toHaveBeenCalled();
  });
});

describe('task-router handler 注册', () => {
  it('getInternalTaskHandler(harness_intervention) 返回 handleIntervention', () => {
    expect(getInternalTaskHandler('harness_intervention')).toBe(handleIntervention);
  });

  it('INTERNAL_TASK_HANDLERS 注册了 harness_intervention', () => {
    expect(INTERNAL_TASK_HANDLERS.harness_intervention).toBe(handleIntervention);
  });

  it('大小写不敏感', () => {
    expect(getInternalTaskHandler('HARNESS_INTERVENTION')).toBe(handleIntervention);
  });

  it('未注册类型返回 null', () => {
    expect(getInternalTaskHandler('dev')).toBeNull();
    expect(getInternalTaskHandler(null)).toBeNull();
    expect(getInternalTaskHandler(123)).toBeNull();
  });
});
