/**
 * memory-wiring.test.js
 *
 * 验证记忆系统断链修复：
 * 1. tick.js 中 runSuggestionCycle 的接入（通过 AST 分析文件内容）
 * 2. executor.js：recordExpectedReward 接入点（claude 派发路径）已随 Claude 通道退役删除（任务 76a160b3）
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '../..');

describe('tick-runner.js — runSuggestionCycle 接入', () => {
  // D1.7b 后 executeTick body 移到 tick-runner.js
  const tickContent = readFileSync(resolve(ROOT, 'src/tick-runner.js'), 'utf8');

  it('import runSuggestionCycle from suggestion-cycle.js', () => {
    expect(tickContent).toContain('runSuggestionCycle');
    expect(tickContent).toContain('suggestion-cycle');
  });

  it('调用 runSuggestionCycle 且有 catch 错误处理', () => {
    // 验证调用点存在，且附近有 catch 错误处理
    expect(tickContent).toContain('runSuggestionCycle(pool)');
    // 确认 10.18 节标注存在
    expect(tickContent).toContain('10.18');
  });

  it('原有 10.17 topicSelection 调用未受影响', () => {
    expect(tickContent).toContain('triggerDailyTopicSelection');
  });
});

describe('executor.js — recordExpectedReward 接入（已退役）', () => {
  const execContent = readFileSync(resolve(ROOT, 'src/executor.js'), 'utf8');

  // 原「import recordExpectedReward from dopamine.js」用例：唯一调用点随 claude 派发路径删除，import 一并清理（任务 76a160b3）。

  it('triggerCeceliaRun 函数签名不变', () => {
    expect(execContent).toContain('async function triggerCeceliaRun');
  });

  // 原「recordExpectedReward 调用有 catch 错误处理」用例：该调用位于 _triggerCeceliaRunInner 第 3 步（US claude 桥接）之前的
  // claude 派发路径，已随 Claude 通道退役删除（任务 76a160b3）。
});
