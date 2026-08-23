/**
 * GP-Anchor: factory/F1 造完真验 #step3
 *
 * r55 (run f51ba12b) 直接死因：冻结合同「## 未覆盖真实链路清单」登记的
 * CANNOT_VERIFY 项（真库 loop.js:1528 集成接缝，postgres=false 环境结构上
 * 不可验证），裁判对它报 passed=false 并在 step/evidence 里声明 deferred=true
 * "does not force FAIL"——但该项既不在合同 verification_stage.deferred_checks
 * 白名单，也不命中 kernel 结构底座专名，两路 deferred 判定全 miss → 机械层
 * 判 failed → 终判 FAIL(evidence_insufficient)。裁判正文全 PASS 却 FAIL，
 * r31「裁判自相矛盾」家族第 N 变体。
 *
 * 修复：第三路白名单 = 冻结合同「未覆盖真实链路清单」段的代码锚 token
 * （file.js:line、反引号片段等）。该段由 proposer 登记、reviewer 审过、seal
 * 冻结，信任等级高于裁判措辞——裁判声明延后 + 命中合同登记锚 → deferred，
 * 不 force FAIL。产品功能步骤不会出现在该表，不构成拆闸。
 */
import { describe, expect, it } from 'vitest';
import {
  validateCoverage,
  parseUncoveredRealChainAnchors,
} from '../../../packages/brain/src/harness-judge.js';

// r55 冻结合同实文（表格条目，含 loop.js:1528 代码锚）
const R55_CONTRACT_SECTION = `
## 未覆盖真实链路清单

| 真实链路点 | 为什么被 mock 顶替 | 真验证补位计划（谁/何时/什么环境） |
|-----------|-------------------|-----------------------------------|
| loop.js:1528 集成：真 Postgres 上 \`observed.decisionLog\` 装载真实 orchestrator_decision_log 行 → 顺延后的 \`deadline_at\` 写回 detail → 下游 hop 读回该顺延窗口 | 本 attempt postgres=false，无真库 | Commander/evaluator 在带 Postgres 的 brain-integration 环境实跑 loop.js 一 hop |

> 本清单存在未真验项：真库 loop.js 集成的**运行时**顺延写回标 \`logic-done-pending\`。

---

## Invariant 覆盖映射
`;

// r55 裁判真实 coverage 形态：实质步骤全 passed，CANNOT_VERIFY 项 passed=false
// 且 deferred 声明写在 step/evidence 文本里，结构化字段却是 false
const R55_COVERAGE = [
  { step: 'Golden Path Step 1 / B-01 — 2-fix slide', step_index: 1, passed: true, deferred: false, evidence: 'green' },
  { step: 'Golden Path Step 2 / B-02 — re-anchor', step_index: 2, passed: true, deferred: false, evidence: 'green' },
  {
    step: 'Real-DB loop.js:1528 integration seam — contract-registered CANNOT_VERIFY [deferred=true]',
    passed: false,
    deferred: false,
    evidence: 'deferred=true | Precondition satisfied: this attempt runtime_resources.postgres=false; registered in contract-draft 未覆盖真实链路清单 as logic-done-pending — does not force FAIL.',
  },
];

const GOLDEN_PATH_STEPS = ['Step 1 2-fix slide 顺延', 'Step 2 re-anchor 重新起算'];

describe('合同「未覆盖真实链路清单」锚 token 解析', () => {
  it('从表格条目提取 file:line 与反引号代码锚', () => {
    const anchors = parseUncoveredRealChainAnchors(R55_CONTRACT_SECTION);
    expect(anchors).toContain('loop.js:1528');
    expect(anchors).toContain('observed.decisionLog');
  });

  it('负向：无该段的合同返回空数组', () => {
    expect(parseUncoveredRealChainAnchors('## E2E\n无关内容')).toEqual([]);
    expect(parseUncoveredRealChainAnchors('')).toEqual([]);
    expect(parseUncoveredRealChainAnchors(null)).toEqual([]);
  });
});

describe('validateCoverage 第三路：合同 CANNOT_VERIFY 登记项 + 裁判延后声明 → deferred', () => {
  it('r55 复刻：CANNOT_VERIFY 项不再落 failed，cov.ok=true', () => {
    const cov = validateCoverage(R55_COVERAGE, GOLDEN_PATH_STEPS, {
      deferredChecks: ['server_required_assertions'],
      uncoveredChainAnchors: parseUncoveredRealChainAnchors(R55_CONTRACT_SECTION),
    });
    expect(cov.failed).toEqual([]);
    expect(cov.ok).toBe(true);
    expect(cov.deferred.some((d) => /loop\.js:1528/.test(d.step))).toBe(true);
  });

  it('负向：裁判未声明延后的 failed 项不因合同锚命中而放行', () => {
    const cov = validateCoverage([
      ...R55_COVERAGE.slice(0, 2),
      { step: 'loop.js:1528 集成写回断言', passed: false, deferred: false, evidence: '断言失败：deadline 未顺延' },
    ], GOLDEN_PATH_STEPS, {
      uncoveredChainAnchors: parseUncoveredRealChainAnchors(R55_CONTRACT_SECTION),
    });
    expect(cov.ok).toBe(false);
    expect(cov.failed.length).toBe(1);
  });

  it('负向：声明延后但措辞不命中任何合同锚 → 仍 failed（防裁判自行扩大范围）', () => {
    const cov = validateCoverage([
      ...R55_COVERAGE.slice(0, 2),
      { step: '某产品功能步骤 [deferred=true]', passed: false, deferred: true, evidence: 'deferred=true 我觉得可以延后' },
    ], GOLDEN_PATH_STEPS, {
      uncoveredChainAnchors: parseUncoveredRealChainAnchors(R55_CONTRACT_SECTION),
    });
    expect(cov.ok).toBe(false);
    expect(cov.failed.length).toBe(1);
  });
});
