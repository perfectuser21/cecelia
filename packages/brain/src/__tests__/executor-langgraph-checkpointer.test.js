/**
 * executor.js — LangGraph PostgresSaver checkpointer 注入测试（C7 重写）
 *
 * C7 之前：executor.js 各分支自己 inline PostgresSaver.fromConnString + setup
 * C7 之后：统一走 orchestrator/pg-checkpointer.js 的 getPgCheckpointer() 单例
 *
 * 本测试做源码结构断言（不 spawn executor）：
 *   1. 不再 inline `PostgresSaver.fromConnString`（已收归 pg-checkpointer.js）
 *   2. harness_planner 分支 import `getPgCheckpointer`（harness_initiative 走 compileHarnessFullGraph，自带 checkpointer）
 *   3. checkpointer 作为 runHarnessPipeline opts 传入（语义不变）
 *   4. 不再手动调 `checkpointer.setup()`（singleton 内部一次搞定）
 *
 * 动机：保持 43 分钟 harness pipeline 的崩溃 resume 能力，同时统一 Brain v2 L2 中央路径。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const executorSrc = readFileSync(path.resolve(__dirname, '../executor.js'), 'utf8');

describe('executor.js — C7 checkpointer singleton 接入', () => {
  it('no longer uses inline PostgresSaver.fromConnString', () => {
    expect(executorSrc).not.toMatch(/PostgresSaver\.fromConnString/);
  });

  it('no longer calls manual checkpointer.setup()', () => {
    expect(executorSrc).not.toMatch(/checkpointer\.setup\(\)/);
  });

  it('imports getPgCheckpointer from orchestrator singleton (harness_planner)', () => {
    const imports = executorSrc.match(/await import\(['"]\.\/orchestrator\/pg-checkpointer\.js['"]\)/g) || [];
    expect(imports.length).toBeGreaterThanOrEqual(1);
  });

  it('awaits getPgCheckpointer() at the harness_planner call site', () => {
    const calls = executorSrc.match(/await getPgCheckpointer\(\)/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('still passes checkpointer to runHarnessPipeline opts', () => {
    const callBlock = executorSrc.match(/runHarnessPipeline\(task,\s*\{[\s\S]{0,800}?\}\)/);
    expect(callBlock).toBeTruthy();
    expect(callBlock[0]).toMatch(/checkpointer/);
  });
});
