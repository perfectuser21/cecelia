/**
 * Regression（2026-06-27 审计）：thread_id 公式 SSOT。
 *
 * 根因：sub-task 子图 thread_id 公式 `harness-task:<init>:<sub>:fix<N><合同后缀>`
 * 在 3 处各拼一遍（initiative.graph runSubTaskNode / task.graph spawnNode /
 * task.graph evaluateContractNode），靠注释纪律保持一致。漂移过即 run da418741 的
 * "死线程"bug（父子 thread_id 失配 → callback router 反查不到 / 复用旧终局 checkpoint
 * 秒回死状态）。抽成单一 buildTaskThreadId() 消除漂移根因。
 */
import { describe, it, expect } from 'vitest';
import { buildTaskThreadId, harnessContractThreadSuffix } from '../harness-utils.js';

describe('buildTaskThreadId — thread_id 公式 SSOT', () => {
  it('格式 = harness-task:<init>:<sub>:fix<round><合同后缀>', () => {
    const tid = buildTaskThreadId('init-1', 'ws1', 0, 'cp-x-feat');
    expect(tid).toBe(`harness-task:init-1:ws1:fix0${harnessContractThreadSuffix('cp-x-feat')}`);
  });

  it('同输入 → 完全一致（三处调用必须产出同一 thread_id，否则父子失配）', () => {
    const a = buildTaskThreadId('i', 's', 2, 'br');
    const b = buildTaskThreadId('i', 's', 2, 'br');
    expect(a).toBe(b);
  });

  it('fixRound 缺省 → fix0', () => {
    expect(buildTaskThreadId('i', 's', null, 'br')).toBe(`harness-task:i:s:fix0${harnessContractThreadSuffix('br')}`);
    expect(buildTaskThreadId('i', 's', undefined, 'br')).toBe(`harness-task:i:s:fix0${harnessContractThreadSuffix('br')}`);
  });

  it('无 contractBranch → 退回旧格式 harness-task:<id>:<ws>:fix<N>（无后缀）', () => {
    expect(buildTaskThreadId('i', 's', 1, null)).toBe('harness-task:i:s:fix1');
    expect(buildTaskThreadId('i', 's', 1, '')).toBe('harness-task:i:s:fix1');
  });

  it('合同变 → thread_id 变（执行历史归零，不复用旧终局 checkpoint）', () => {
    const t1 = buildTaskThreadId('i', 's', 0, 'contract-A');
    const t2 = buildTaskThreadId('i', 's', 0, 'contract-B');
    expect(t1).not.toBe(t2);
  });
});
