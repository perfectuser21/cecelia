/**
 * external-executor-predicate.test.js
 *
 * 统一谓词 isExternallyExecuted(task)：「这条活的进程不在 Brain 本机」。
 *
 * 0929 实证两条同类 bug 的共同根因——本机进程证据对外部执行体恒为空：
 *   A) 启动同步 syncOrphanTasksOnStartup 把 device_job / openclaw-agent 秋米任务当孤儿回队
 *   B) 运行期 probeTaskLiveness 把刚起 4 分钟的秋米任务（87c9a08b）SUSPECT→DEAD→零证据回队
 *
 * 谓词必须从注册表派生（铁律 76cb816c），不许在消费方手抄类型名单。
 */
import { describe, it, expect } from 'vitest';
import {
  isExternallyExecuted,
  EXTERNALLY_EXECUTED_KINDS,
} from '../executor-contracts.js';
import {
  EXTERNALLY_EXECUTED_TASK_TYPES,
  TASK_TYPE_REGISTRY,
} from '../lib/task-type-registry.js';

describe('isExternallyExecuted —— 外部执行体统一谓词', () => {
  it('device_job（西安 Mac 领单器执行）→ true', () => {
    expect(isExternallyExecuted({ task_type: 'device_job', executor_kind: null })).toBe(true);
  });

  it('qiumi_task（MMV 上 openclaw agent 执行）→ true，即使 executor_kind 尚未落库（ssh 派发在途）', () => {
    expect(isExternallyExecuted({ task_type: 'qiumi_task', executor_kind: 'openclaw-agent' })).toBe(true);
    expect(isExternallyExecuted({ task_type: 'qiumi_task', executor_kind: null })).toBe(true);
  });

  it('script_run（跑场机 ssh 脚本）→ true', () => {
    expect(isExternallyExecuted({ task_type: 'script_run', executor_kind: 'script' })).toBe(true);
  });

  it('持久化 executor_kind 属外部执行体集合 → true（不依赖 task_type）', () => {
    expect(isExternallyExecuted({ task_type: 'unknown_x', executor_kind: 'openclaw-agent' })).toBe(true);
    expect(isExternallyExecuted({ task_type: 'unknown_x', executor_kind: 'script' })).toBe(true);
  });

  it('本机执行的任务类型 → false（行为不变）', () => {
    expect(isExternallyExecuted({ task_type: 'dev', executor_kind: 'brain-local' })).toBe(false);
    expect(isExternallyExecuted({ task_type: 'dev', executor_kind: null })).toBe(false);
    expect(isExternallyExecuted({ task_type: 'harness_initiative', executor_kind: 'relay-container' })).toBe(false);
    expect(isExternallyExecuted({ task_type: 'codex_qa', executor_kind: 'bridge' })).toBe(false);
  });

  it('content-pipeline 家族不纳入（启动同步对它的既有回队语义不变）', () => {
    expect(isExternallyExecuted({ task_type: 'content-pipeline', executor_kind: null })).toBe(false);
    expect(isExternallyExecuted({ task_type: 'content-export', executor_kind: 'external-worker' })).toBe(false);
  });

  it('空输入 → false，不抛', () => {
    expect(isExternallyExecuted(null)).toBe(false);
    expect(isExternallyExecuted(undefined)).toBe(false);
    expect(isExternallyExecuted({})).toBe(false);
  });
});

describe('外部执行体集合从注册表派生，不手抄', () => {
  it('EXTERNALLY_EXECUTED_TASK_TYPES 恰为 device_job / janitor / qiumi_task / script_run', () => {
    expect([...EXTERNALLY_EXECUTED_TASK_TYPES].sort()).toEqual(['device_job', 'janitor', 'qiumi_task', 'script_run']);
  });

  it('EXTERNALLY_EXECUTED_KINDS = 上述类型在注册表里声明的 executor（去 null 去重）', () => {
    const expected = [...new Set(
      EXTERNALLY_EXECUTED_TASK_TYPES.map((t) => TASK_TYPE_REGISTRY[t].executor).filter(Boolean),
    )].sort();
    expect([...EXTERNALLY_EXECUTED_KINDS].sort()).toEqual(expected);
    expect([...EXTERNALLY_EXECUTED_KINDS].sort()).toEqual(['openclaw-agent', 'preview-janitor', 'script']);
  });
});
