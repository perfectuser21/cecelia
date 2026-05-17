# PRD: PR-C — lint-no-mock-only-test 拦"全 mock 测试"

## 背景

接 Tier 0/1/2（PR #2664/#2665/#2666/#2667）+ hotfix #2668。lint-test-quality 拦了 stub（只 grep src 不调函数）和 .skip，但**没拦"调函数但所有依赖全 mock"的 heavy-mock 测试** —— 这是 PR #2660 dispatcher Phase 2.5 drain bug 的根因（mock 全过 prod 真挂）。

4 agent 审计数据：
- 49 个 heavy mock 文件（vi.mock >= 10）
- top 案例：execution-callback-no-diagnostic.test.js 44 mocks / effectiveresult-db-fallback.test.js 44 mocks
- 平均 5.28 mock/文件

## 用户原话

> 我现在只需要你解决的是整个 foundation 的问题，CI/CD，TDD，1-to-1 test

## 范围

### 一、`.github/workflows/scripts/lint-no-mock-only-test.sh`

仅作用于新增 test 文件（diff-filter=A），老的 grandfather。

**HARD FAIL** 规则：
- vi.mock 数 ≥ HEAVY_MOCK_THRESHOLD（默认 30）
- 且 PR diff 中无配套真覆盖（任一）：
  - 同 PR 加了 packages/brain/scripts/smoke/*.sh
  - 同 PR 加了 src/__tests__/integration/*.test.js
  - 文件本身在 /integration/ 路径下

### 二、自跑 smoke `__tests__/lint-no-mock-only-test-cases.sh`

4 case：
- A: heavy-no-cover → FAIL
- B: heavy-with-smoke → PASS
- C: heavy-with-integ → PASS
- D: light-mock (5) → PASS

### 三、CI 接入

ci.yml 加 lint-no-mock-only-test job + ci-passed needs

### 四、Engine 18.11.0 → 18.12.0

## 验收

- 4 case 自跑全 pass
- 本 PR 自身 CI 通过（无新增 test → 跳过）
- 下个 PR 加 vi.mock=30+ 的新 test 但无 smoke → CI 真拦
