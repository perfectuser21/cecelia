# Sprint 产物契约（Phase 1 骨架）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（已全量勘探，inline 执行）。Steps 用 `- [ ]`。

**Goal:** 新建 sprint-result-contract.js（四段契约组装+校验），reportNode 用它产出 tasks.result.report_content（SSOT）。

**Architecture:** 纯函数 build/validate（不碰 DB），reportNode 把现有 locals 喂给 build 后 stringify。现可填字段填，Phase2 字段留空 stub。零消费者读旧 report_content，改 key 安全。

**Tech Stack:** Node ESM, vitest。

---

## File Structure
- Create `packages/brain/src/sprint-result-contract.js` — 契约 build + validate（纯函数）
- Create `packages/brain/src/__tests__/sprint-result-contract.test.js` — 单测
- Modify `packages/brain/src/workflows/harness-initiative.graph.js` — reportNode 组装行（~1459-1469）+ 顶部 import

红线：只动上述；不碰 pick/advance 循环、其他节点、写库 SQL、zenithjoy-skills。

---

## Task 1：契约模块（TDD）

- [ ] **Step 1: 写失败测试** `packages/brain/src/__tests__/sprint-result-contract.test.js`

```js
import { describe, it, expect } from 'vitest';
import { buildSprintResultContract, validateSprintResultContract, SPRINT_RESULT_CONTRACT_VERSION } from '../sprint-result-contract.js';

describe('buildSprintResultContract', () => {
  it('全量 input → 四段齐全 + 映射正确', () => {
    const c = buildSprintResultContract({
      initiativeId: 'init-1', verdict: 'PASS', failedScenarios: [],
      subTasks: [{ id: 'ws1', status: 'merged' }],
      stepTiming: [{ node: 'planner', started_at: '2026-06-20T00:00:00.000Z', duration_ms: 1000 }],
      wsIssues: [], wsCosts: [{ ws_id: 'ws1', cost_usd: 0.5 }], costUsd: 0.5,
      completedAt: '2026-06-20T00:10:00.000Z',
    });
    expect(c.contract_version).toBe(SPRINT_RESULT_CONTRACT_VERSION);
    expect(c.verdict).toBe('PASS');
    expect(c.total_cost).toBe(0.5);
    expect(c.node_telemetry[0]).toMatchObject({ node: 'planner', start_ts: '2026-06-20T00:00:00.000Z', end_ts: '2026-06-20T00:00:01.000Z', tokens: null, cost: null });
    expect(c.produced_assets).toEqual({ skills: [], tests: [], decisions: [] });
    expect(validateSprintResultContract(c)).toBe(true);
  });

  it('空 input → stub 空默认 + 不抛', () => {
    const c = buildSprintResultContract();
    expect(c.verdict).toBeNull();
    expect(c.failed_scenarios).toEqual([]);
    expect(c.incidental_bugs).toEqual([]);
    expect(c.improvement_items).toEqual([]);
    expect(c.linked_issues).toEqual([]);
    expect(c.open_issues_with_learnings).toEqual([]);
    expect(c.node_telemetry).toEqual([]);
    expect(c.total_cost).toBe(0);
    expect(c.total_tokens).toBeNull();
    expect(c.change_summary).toBeNull();
    expect(c.next_action).toBeNull();
    expect(c.learning_ref).toBeNull();
    expect(validateSprintResultContract(c)).toBe(true);
  });

  it('stepTiming 缺 duration_ms → end_ts=null 不抛', () => {
    const c = buildSprintResultContract({ stepTiming: [{ node: 'gan', started_at: '2026-06-20T00:00:00.000Z' }] });
    expect(c.node_telemetry[0].end_ts).toBeNull();
    expect(c.node_telemetry[0].start_ts).toBe('2026-06-20T00:00:00.000Z');
  });
});

describe('validateSprintResultContract', () => {
  it('合法契约通过', () => { expect(validateSprintResultContract(buildSprintResultContract())).toBe(true); });
  it('非对象抛', () => { expect(() => validateSprintResultContract(null)).toThrow(/object/); });
  it('缺字段抛', () => { const c = buildSprintResultContract(); delete c.node_telemetry; expect(() => validateSprintResultContract(c)).toThrow(/node_telemetry/); });
  it('字段类型错抛', () => { const c = buildSprintResultContract(); c.incidental_bugs = 'x'; expect(() => validateSprintResultContract(c)).toThrow(/incidental_bugs/); });
});
```

- [ ] **Step 2: 跑测试确认 RED**

Run: `cd /Users/administrator/worktrees/cecelia/sprint-result-contract/packages/brain && ../../node_modules/.bin/vitest run src/__tests__/sprint-result-contract.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现** `packages/brain/src/sprint-result-contract.js`

```js
/**
 * Sprint 产物契约（闭环边界 SSOT）。
 * reportNode 在 sprint 结尾产出它；Phase2 读取者（展示/继承/立案）读这一份。
 * 纯函数，不碰 DB。
 */

export const SPRINT_RESULT_CONTRACT_VERSION = 1;

const ARRAY_FIELDS = ['failed_scenarios', 'incidental_bugs', 'improvement_items',
  'linked_issues', 'open_issues_with_learnings', 'node_telemetry', 'sub_tasks', 'ws_issues', 'ws_costs'];

const REQUIRED_KEYS = ['contract_version', 'initiative_id', 'verdict', 'failed_scenarios',
  'change_summary', 'next_action', 'produced_assets', 'learning_ref', 'incidental_bugs',
  'improvement_items', 'linked_issues', 'open_issues_with_learnings', 'node_telemetry',
  'total_tokens', 'total_cost', 'sub_tasks', 'ws_issues', 'ws_costs', 'completed_at'];

/**
 * 从 reportNode 已算好的 locals 组装完整契约。缺失输入用安全默认，永不抛。
 * @param {object} [input]
 */
export function buildSprintResultContract(input = {}) {
  const {
    initiativeId = null, verdict = null, failedScenarios = [], subTasks = [],
    stepTiming = [], wsIssues = [], wsCosts = [], costUsd = 0, completedAt = null,
  } = input || {};

  // ④ node_telemetry：从 stepTiming {node, started_at, duration_ms} 推 start_ts/end_ts
  const node_telemetry = (Array.isArray(stepTiming) ? stepTiming : []).map((s) => {
    let end_ts = null;
    if (s && s.started_at && typeof s.duration_ms === 'number') {
      end_ts = new Date(new Date(s.started_at).getTime() + s.duration_ms).toISOString();
    }
    return {
      node: (s && s.node) || 'unknown',
      start_ts: (s && s.started_at) || null,
      end_ts,
      tokens: null, // TODO(Phase2-采集器)：逐节点 token
      cost: null,   // TODO(Phase2-采集器)
    };
  });

  return {
    contract_version: SPRINT_RESULT_CONTRACT_VERSION,
    initiative_id: initiativeId,

    // ① 结果
    verdict,
    failed_scenarios: Array.isArray(failedScenarios) ? failedScenarios : [],
    change_summary: null, // TODO(Phase2-采集器)：从 PR diff/标题归纳
    next_action: null,    // TODO(Phase2-采集器)

    // ② 产出资产
    produced_assets: { skills: [], tests: [], decisions: [] }, // TODO(Phase2-采集器)
    learning_ref: null,   // TODO(Phase2-采集器)

    // ③ 发现
    incidental_bugs: [],            // TODO(Phase2-采集器)：路上撞见的非本次 bug
    improvement_items: [],          // TODO(Phase2-采集器)：持续改进项（非 bug）
    linked_issues: [],              // TODO(Phase2-采集器)：关联 Notion Issue id
    open_issues_with_learnings: [], // TODO(Phase2-采集器)：未解决 issue + 累积 learning

    // ④ 遥测
    node_telemetry,
    total_tokens: null, // TODO(Phase2-采集器)
    total_cost: typeof costUsd === 'number' ? costUsd : 0,

    // 兼容字段（保留现有 report_content 消费者）
    sub_tasks: Array.isArray(subTasks) ? subTasks : [],
    ws_issues: Array.isArray(wsIssues) ? wsIssues : [],
    ws_costs: Array.isArray(wsCosts) ? wsCosts : [],
    completed_at: completedAt,
  };
}

/**
 * 校验契约结构：四段齐全 + 类型正确。非法抛 Error。
 * @param {object} obj
 * @returns {true}
 */
export function validateSprintResultContract(obj) {
  if (!obj || typeof obj !== 'object') {
    throw new Error('sprint-result-contract: root must be object');
  }
  for (const k of REQUIRED_KEYS) {
    if (!(k in obj)) throw new Error(`sprint-result-contract: missing field "${k}"`);
  }
  if (obj.contract_version !== SPRINT_RESULT_CONTRACT_VERSION) {
    throw new Error(`sprint-result-contract: version ${obj.contract_version} !== ${SPRINT_RESULT_CONTRACT_VERSION}`);
  }
  for (const k of ARRAY_FIELDS) {
    if (!Array.isArray(obj[k])) throw new Error(`sprint-result-contract: "${k}" must be array`);
  }
  const pa = obj.produced_assets;
  if (!pa || typeof pa !== 'object' || !Array.isArray(pa.skills) || !Array.isArray(pa.tests) || !Array.isArray(pa.decisions)) {
    throw new Error('sprint-result-contract: produced_assets must be {skills[],tests[],decisions[]}');
  }
  return true;
}
```

- [ ] **Step 4: 跑测试转绿** — 同 Step 2 命令，Expected: PASS（10 tests）。

- [ ] **Step 5: commit-1（test）+ commit-2（impl）**

```bash
cd /Users/administrator/worktrees/cecelia/sprint-result-contract
git add packages/brain/src/__tests__/sprint-result-contract.test.js
git commit -m "test(harness): Sprint 产物契约 build/validate — failing test"
git add packages/brain/src/sprint-result-contract.js
git commit -m "feat(harness): Sprint 产物契约模块 build/validate（闭环边界 SSOT 骨架）"
```

---

## Task 2：reportNode 接契约

- [ ] **Step 1: graph.js 顶部加 import**

在 harness-initiative.graph.js 现有 import 区加：
```js
import { buildSprintResultContract } from '../sprint-result-contract.js';
```

- [ ] **Step 2: 替换 reportContent 组装（现 ~1459-1469）**

把：
```js
  const reportContent = JSON.stringify({
    initiativeId: state.initiativeId,
    sub_tasks: reconciledSubTasks,
    final_e2e_verdict: computedVerdict,
    failed_scenarios: state.final_e2e_failed_scenarios || [],
    step_timing,
    ws_issues,
    ws_costs,
    cost_usd: (state.sub_tasks || []).reduce((a, s) => a + (s.cost_usd || 0), 0),
    completed_at: new Date().toISOString(),
  }, null, 2);
```
替换为：
```js
  const contract = buildSprintResultContract({
    initiativeId: state.initiativeId,
    verdict: computedVerdict,
    failedScenarios: state.final_e2e_failed_scenarios || [],
    subTasks: reconciledSubTasks,
    stepTiming: step_timing,
    wsIssues: ws_issues,
    wsCosts: ws_costs,
    costUsd: (state.sub_tasks || []).reduce((a, s) => a + (s.cost_usd || 0), 0),
    completedAt: new Date().toISOString(),
  });
  const reportContent = JSON.stringify(contract, null, 2);
```

- [ ] **Step 3: 跑 reportNode 相关测试确认不破**

Run: `cd .../packages/brain && ../../node_modules/.bin/vitest run src/__tests__/harness-report-merge-recheck.test.js src/__tests__/harness-report-self-merge-gate.test.js src/workflows/__tests__/harness-initiative.graph.test.js`
Expected: PASS（report_content 无消费者断言旧 key，改名安全）。

- [ ] **Step 4: commit**

```bash
git add packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "feat(harness): reportNode 产出 Sprint 产物契约（取代 ad-hoc report_content）"
```

---

## Task 3：收尾门禁

- [ ] **Step 1: lint-test-pairing**

Run: `cd /Users/administrator/worktrees/cecelia/sprint-result-contract && bash .github/workflows/scripts/lint-test-pairing.sh origin/main`
Expected: 通过（新 src sprint-result-contract.js 有配套 test；reportNode 所在 graph.js 配套 graph.test.js 已存在）。

- [ ] **Step 2: brain eslint 零 warning**

Run: `cd .../packages/brain && ../../node_modules/.bin/eslint src/sprint-result-contract.js src/workflows/harness-initiative.graph.js --max-warnings 0`
Expected: 无输出（0 warning）。

- [ ] **Step 3: DevGate**

Run: `cd /Users/administrator/worktrees/cecelia/sprint-result-contract && node scripts/facts-check.mjs && bash scripts/check-version-sync.sh`
Expected: 全通过。

---

## Self-Review
- Spec coverage：契约模块（T1）✅ / reportNode 接（T2）✅ / 门禁（T3）✅
- 无占位符：build/validate/test 全量代码已给 ✅
- 类型一致：input 字段名（initiativeId/verdict/...）与 reportNode 调用处一致 ✅
- 红线：只动新建文件 + reportNode 组装行 + 一行 import ✅
