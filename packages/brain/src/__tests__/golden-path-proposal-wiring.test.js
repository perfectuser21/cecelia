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
