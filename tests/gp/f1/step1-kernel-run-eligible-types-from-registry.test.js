// F1「工厂 · 开发闭环」步骤 1 —— 接单进车间即分档。
//
// kernel-run-store.js 的 createKernelRun() 用 ELIGIBLE_TASK_TYPES 白名单挡下不该
// 起 Kernel Run 的 task_type（分档判断的第一道门）。qiumi_task PR1 地基把这份白名单
// 从裸字面量 `new Set(['harness_initiative', 'golden_path_proposal'])` 改成从
// lib/task-type-registry.js 的 KERNEL_RUN_ELIGIBLE_TASK_TYPES 派生集合读取——本文件
// 是 lint-gp-anchor-artifact 要求的步骤断言：真 import 被改的两个流水线/注册表模块
// （不 mock 任一个），钉住这次改写对基线字面量零行为变化。
//
// 真 import 被改模块 orchestrator/kernel-run-store.js（lint-gp-anchor-artifact 要求），
// 不 mock 它；同时真 import lib/task-type-registry.js，确认 kernel-run-store.js 读的
// 确实是注册表派生集合，不是自己另起一份拷贝。

import { describe, it, expect } from 'vitest';
import { __test__ } from '../../../packages/brain/src/orchestrator/kernel-run-store.js';
import { KERNEL_RUN_ELIGIBLE_TASK_TYPES } from '../../../packages/brain/src/lib/task-type-registry.js';

// 基线字面量 fixture：替换前 kernel-run-store.js 里
// `const ELIGIBLE_TASK_TYPES = new Set(['harness_initiative', 'golden_path_proposal']);`
// 原样抄出（origin/main 458_relay_spine.sql 之前、本 PR1 改写之前的样子）。
const BASELINE_ELIGIBLE_TASK_TYPES = ['harness_initiative', 'golden_path_proposal'];

describe('GP F1 step1 — kernel-run-store 的分档白名单改读注册表', () => {
  it('kernel-run-store.__test__.ELIGIBLE_TASK_TYPES 与替换前的字面量 fixture 逐一相等（含个数）', () => {
    const actual = [...__test__.ELIGIBLE_TASK_TYPES];
    expect(actual.length, `长度不等：actual=${JSON.stringify(actual)}`).toBe(BASELINE_ELIGIBLE_TASK_TYPES.length);
    expect(new Set(actual)).toEqual(new Set(BASELINE_ELIGIBLE_TASK_TYPES));
  });

  it('kernel-run-store 的白名单确实来自注册表派生集合，不是本地另起的拷贝', () => {
    // 两边转 Set 比较成员一致——kernel-run-store.js 用 `new Set(KERNEL_RUN_ELIGIBLE_TASK_TYPES)`
    // 包装注册表数组，成员必须与注册表本身逐一相等（同一份数据的两种视图）。
    expect(new Set(__test__.ELIGIBLE_TASK_TYPES)).toEqual(new Set(KERNEL_RUN_ELIGIBLE_TASK_TYPES));
  });

  it('注册表派生集合本身也与基线字面量零行为变化（双重锁：改注册表标签不会悄悄改变此白名单）', () => {
    expect(KERNEL_RUN_ELIGIBLE_TASK_TYPES.length).toBe(BASELINE_ELIGIBLE_TASK_TYPES.length);
    expect(new Set(KERNEL_RUN_ELIGIBLE_TASK_TYPES)).toEqual(new Set(BASELINE_ELIGIBLE_TASK_TYPES));
  });

  it('qiumi_task 不在此白名单里（它走 openclaw-agent 执行体合同，不走 Kernel Run）', () => {
    expect(__test__.ELIGIBLE_TASK_TYPES.has('qiumi_task')).toBe(false);
  });
});
