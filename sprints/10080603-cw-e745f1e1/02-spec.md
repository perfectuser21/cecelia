---
task_id: e745f1e1-982a-4d45-beac-4b56972a2312
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3"]
---
# 规格：contract-exists 排除 coding workflow 产物

### S-1
对应：I-1、I-2

改动文件：`packages/brain/scripts/ci/contract-exists.mjs`

做法：
- 新增常量 `CODING_WORKFLOW_FILE = /(^|\/)sprints\/[^/]+\/0[1-4]-(intent|spec|build|evidence)\.md$/`，只匹配 coding workflow 的四个固定产物名（`01-intent.md`、`02-spec.md`、`03-build.md`、`04-evidence.md`），且必须直接位于 `sprints/<目录>/` 下一层。
- `touchesSprints` 的判定改为：存在文件 f 满足「路径含 `sprints/`、不含 `sprints/archive/`、且不匹配 `CODING_WORKFLOW_FILE`」。
- 其余逻辑不动：`sprints/<id>/sprint-prd.md`、`tests/*.ts` 等其他 sprints 下文件仍视为 harness 改动，缺 `contract-draft.md` 仍 exit 1 并在 stderr 点名 `contract-draft.md`。
- 同步更新文件头部「规则」注释，补一条「coding workflow 的 01~04 产物文件不算 harness PR」。

验证：
- 新建 fixture 清单（见 S-2），执行 `node packages/brain/scripts/ci/contract-exists.mjs --fixture packages/brain/scripts/ci/__tests__/fixtures/diff-coding-workflow.txt`，断言退出码 0（I-1）。
- 执行 `node packages/brain/scripts/ci/contract-exists.mjs --fixture packages/brain/scripts/ci/__tests__/fixtures/diff-harness-prd-only.txt`，断言退出码非 0 且 stderr 含 `contract-draft.md`（I-2）。
- 现有三个 fixture（`diff-missing-contract.txt` 仍非 0，`diff-complete.txt`、`diff-non-harness.txt` 仍为 0）行为不变。

### S-2
对应：I-1、I-2

改动文件（新增 fixture）：
- `packages/brain/scripts/ci/__tests__/fixtures/diff-coding-workflow.txt`，内容四行：
  `A	sprints/10080335-cw-c954ebfd/01-intent.md`、`A	sprints/10080335-cw-c954ebfd/02-spec.md`、`A	sprints/10080335-cw-c954ebfd/03-build.md`、`A	sprints/10080335-cw-c954ebfd/04-evidence.md`
- `packages/brain/scripts/ci/__tests__/fixtures/diff-harness-prd-only.txt`，内容一行：
  `A	sprints/06111530-fix-forensics-smoke/sprint-prd.md`

验证：`cat` 两个文件确认内容与上面一致；两个文件被 S-3 的测试引用并通过。

### S-3
对应：I-3（同时落实 I-1、I-2 的回归测试）

改动文件：`packages/brain/src/__tests__/ci-defense.test.ts`

做法：在 `describe('CI 防线三件套 [BEHAVIOR]')` 末尾新增两个 `it`，复用现有 `runNode` / `EXISTS` / `FIXTURES`：
1. `Step4 coding workflow: 仅含 01~04 产物的 sprint diff 不被当 harness PR 拦` —— 对 `diff-coding-workflow.txt` 断言 `code` 为 0。
2. `Step4 harness 残留: 仅含 sprint-prd.md 的 diff 仍被拦并点名 contract-draft.md` —— 对 `diff-harness-prd-only.txt` 断言 `code` 不为 0，且 `out` 匹配 `/contract-draft\.md/`。

验证：
- 先在未改 `contract-exists.mjs`（S-1）时运行，第 1 个新用例应失败（证明测试能复现 bug）；改完 S-1 后通过。
- `cd packages/brain && npx vitest run src/__tests__/ci-defense.test.ts` 全部通过（原 5 个用例 + 新增 2 个，共 7 个）。
