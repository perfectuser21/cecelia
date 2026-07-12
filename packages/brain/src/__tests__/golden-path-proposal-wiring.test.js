/**
 * GP2/T2 executor 派发接线（DoD F2）。
 * dispatch 分支/override 排除用源码断言（同 all-features-smoke.test.js 读源模式）——
 * executeTask 全链需重基建 fake，接线正确性由字面量条件保证。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EXECUTOR_KIND_FOR } from '../executor-contracts.js';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../executor.js'), 'utf8'
);

describe('executor: golden_path_proposal 派发接线', () => {
  it('EXECUTOR_KIND_FOR 打标 relay-container', () => {
    expect(EXECUTOR_KIND_FOR.golden_path_proposal).toBe('relay-container');
  });

  it('dispatch 分支覆盖 golden_path_proposal（复用 runHarnessInitiativeRouter）', () => {
    expect(SRC).toMatch(
      /task\.task_type === 'harness_initiative' \|\| task\.task_type === 'golden_path_proposal'/
    );
  });

  it('显式 machine/executor override 排除 golden_path_proposal（防劫持绕过 relay）', () => {
    expect(SRC).toMatch(
      /task\.task_type !== 'harness_initiative' &&\s*task\.task_type !== 'golden_path_proposal'/
    );
  });
});

const DISPATCHER_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../dispatcher.js'), 'utf8'
);

describe('dispatcher: golden_path_proposal 防线接线', () => {
  it('并发 cap 计数 SQL 口径含 golden_path_proposal', () => {
    expect(DISPATCHER_SRC).toMatch(
      /task_type IN \('harness_initiative', 'golden_path_proposal'\)/
    );
  });
  it('INITIATIVE_LOCK_TASK_TYPES 含 golden_path_proposal', () => {
    const lockBlock = DISPATCHER_SRC.match(/INITIATIVE_LOCK_TASK_TYPES = \[[\s\S]*?\]/)[0];
    expect(lockBlock).toContain("'golden_path_proposal',");
  });
  it('needsBridgeCheck 豁免 golden_path_proposal（relay 不依赖 bridge）', () => {
    expect(DISPATCHER_SRC).toMatch(
      /nextTask\.task_type !== 'harness_initiative'\s*&&\s*nextTask\.task_type !== 'golden_path_proposal'/
    );
  });
  it('绝不在 retired 集合（加了 = 派发即 terminal failed）', () => {
    const retiredBlock = DISPATCHER_SRC.match(/_RETIRED_HARNESS_TYPES_DISPATCH = new Set\(\[[\s\S]*?\]\)/)[0];
    expect(retiredBlock).not.toContain('golden_path_proposal');
  });
});
