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
