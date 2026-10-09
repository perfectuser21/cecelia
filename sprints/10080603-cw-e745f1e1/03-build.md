---
task_id: e745f1e1-982a-4d45-beac-4b56972a2312
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3"]
---
# 构建记录

三条规格合并为一个提交 `8a09389d667a9954f0a635c38be28ad03ab97ef2`（fix(ci): contract-exists 不把 coding workflow 的 01~04 产物当 harness PR）。

### B-1
对应：S-1

- 改动文件：`packages/brain/scripts/ci/contract-exists.mjs`
  - 新增常量 `CODING_WORKFLOW_FILE = /(^|\/)sprints\/[^/]+\/0[1-4]-(intent|spec|build|evidence)\.md$/`
  - `touchesSprints` 增加 `!CODING_WORKFLOW_FILE.test(f)` 条件
  - 头部「规则」注释补一条 coding workflow 01~04 产物不算 harness PR
- 新增测试：见 B-3（先写测试）
- 实际运行：
  - TDD 红：实现前 `cd packages/brain && npx vitest run src/__tests__/ci-defense.test.ts` → `7 tests | 1 failed`，失败用例为「Step4 coding workflow…」，`expected 1 to be +0`
  - TDD 绿：实现后逐个 fixture 运行 `node packages/brain/scripts/ci/contract-exists.mjs --fixture …/diff-<name>.txt`，退出码：coding-workflow=0、harness-prd-only=1（stderr 含 `contract-draft.md`）、missing-contract=1、complete=0、non-harness=0
- 提交 SHA：8a09389d667a9954f0a635c38be28ad03ab97ef2

### B-2
对应：S-2

- 改动文件（新增）：
  - `packages/brain/scripts/ci/__tests__/fixtures/diff-coding-workflow.txt`（四行：`A<TAB>sprints/10080335-cw-c954ebfd/01~04-*.md`）
  - `packages/brain/scripts/ci/__tests__/fixtures/diff-harness-prd-only.txt`（一行：`A<TAB>sprints/06111530-fix-forensics-smoke/sprint-prd.md`）
- 新增测试：由 B-3 的两个用例引用
- 实际运行：创建后 `cat` 核对内容与规格一致；被 B-3 用例引用并通过
- 提交 SHA：8a09389d667a9954f0a635c38be28ad03ab97ef2

### B-3
对应：S-3

- 改动文件：`packages/brain/src/__tests__/ci-defense.test.ts`
- 新增测试（`describe('CI 防线三件套 [BEHAVIOR]')` 末尾两个 `it`）：
  1. `Step4 coding workflow: 仅含 01~04 产物的 sprint diff 不被当 harness PR 拦`
  2. `Step4 harness 残留: 仅含 sprint-prd.md 的 diff 仍被拦并点名 contract-draft.md`
- 实际运行：
  - 实现前（红）：`cd packages/brain && npx vitest run src/__tests__/ci-defense.test.ts` → `Tests 1 failed | 6 passed (7)`，失败的是第 1 个新用例
  - 实现后（绿）：`npx vitest run --root packages/brain src/__tests__/ci-defense.test.ts` → `Test Files 1 passed (1)`、`Tests 7 passed (7)`
- 提交 SHA：8a09389d667a9954f0a635c38be28ad03ab97ef2
