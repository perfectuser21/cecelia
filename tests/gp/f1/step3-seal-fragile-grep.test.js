// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：封印完整性 ↔ manual 命令可执行性
//
// 2026-08-23 生产实证（r51 run 587f4f0e，r45 族第 4 变体）：冻结 contract-dod 的
// manual 命令用 `grep -q "1 passed (1)"` 做断言，但命令同时带 vitest `-t` 过滤——
// -t 过滤下其余用例被 skip，实际输出是 "1 passed | 2 skipped (3)"，精确尾缀
// grep 必败 → CI dod-behavior-dynamic 确定性红 → fix 四连死于无权改冻结文档。
// 修法：封印时静态拦——合同全文中同一 manual 命令既带 `-t` 过滤又用
// `passed ([0-9]+)` 精确尾缀 grep 的，拒封印（FRAGILE_GREP，打回 proposer 换
// `grep -qE "[1-9][0-9]* passed"` 宽松式）；无 -t 的整文件跑允许精确尾缀。
import { describe, expect, it } from 'vitest';
import { assertTestContractResolvable } from '../../../packages/brain/src/orchestrator/contract-test-paths-seal.js';

const SPRINT = 'sprints/08222322-kernel-x';
const ARTIFACTS = [
  { path: `${SPRINT}/contract-draft.md`, content: 'x' },
  { path: `${SPRINT}/tests/w.test.js`, content: "it('window', () => {})" },
];

const TABLE = `## Test Contract
| 功能 | Test File | BEHAVIOR | 红证据 |
|---|---|---|---|
| w | \`${SPRINT}/tests/w.test.js\` | \`window\` | FAIL |
`;

function contractWith(manualCmd) {
  return `${TABLE}

## DoD
- [ ] [BEHAVIOR] x
  Test: manual:bash -c '${manualCmd}'
`;
}

describe('F1 step3：seal 静态拦 -t 过滤下必败的精确 grep（r51 案卷）', () => {
  it('-t 过滤 + 精确 passed-(N) 尾缀 grep → 拒封印（r51 死锁复现）', () => {
    const cmd = 'out=$(npx vitest run sprints/x/tests/w.test.js -t "窗口" 2>&1); echo "$out" | grep -q "1 passed (1)"';
    expect(() => assertTestContractResolvable(contractWith(cmd), ARTIFACTS))
      .toThrow(/FROZEN_CONTRACT_TEST_CONTRACT_FRAGILE_GREP/);
  });

  it('-t 过滤 + 宽松 grep（无精确尾缀）→ 放行', () => {
    const cmd = 'out=$(npx vitest run sprints/x/tests/w.test.js -t "窗口" 2>&1); echo "$out" | grep -qE "[1-9][0-9]* passed"';
    expect(() => assertTestContractResolvable(contractWith(cmd), ARTIFACTS)).not.toThrow();
  });

  it('无 -t 的整文件跑 + 精确尾缀 → 放行（输出无 skipped 干扰）', () => {
    const cmd = 'out=$(npx vitest run sprints/x/tests/w.test.js 2>&1); echo "$out" | grep -q "3 passed (3)"';
    expect(() => assertTestContractResolvable(contractWith(cmd), ARTIFACTS)).not.toThrow();
  });

  it('无 manual 命令的合同 → 不受影响', () => {
    expect(() => assertTestContractResolvable(TABLE, ARTIFACTS)).not.toThrow();
  });
});
