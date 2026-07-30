# Sprint Contract Draft (Round 10)

覆盖父路「Draft PR #4457 累计冲突与 CodeQL 收敛」第 1-5 步。

## 合同 notes

- Round 10 采用 controller 的权威 machine facts，消除旧版 `32/33` 与 CodeQL 口径歧义：总冲突路径固定为 33（32 个 content + `DoD.md` 1 个 modify/delete）；77 固定指 check-run `90774353140` 的 PR-new-alert annotations。
- 本轮保持 Round 9 已完成的三项修复：两个 ARTIFACT oracle 使用内容/schema/身份/exact-set 与七阶段真实行为断言（不采用仅存在性证明）；33 路径的完整 `path → oracle_id → cwd/argv → expected_observation` 已冻结为合同 manifest；审阅门从权威运行时输入绑定 lineage。
- 本次 proposer 权威 lineage：run=`37ff56f3-7b8a-4c54-b710-4ab270c59521`、attempt=`47d4a8a2-d82d-41bd-a38a-0e7cbc726820`、task=`f21957f6-2ae5-4db3-822e-90c3f474fc19`。该值只认证本轮合同产出；generator/evaluator 必须分别从各自 task bundle 或签名 execution receipt 读取其实际 lineage，禁止继承本值作为 mutation actor。
- contract-gate: enabled（`packages/brain/src/lib/contract-gate.js` 存在）。
- context-manifest: unavailable；PRD 明示本 line 暂无累积 FR。
- 不新增 PR、不 merge、不 deploy；generator 只能更新既有 `cp-kernel-phase5b-a1-review-fixes`。

## Response Schema（推导来源: PRD字面）

N/A — 本任务不新增 HTTP 响应；外部 GitHub 证据字段按 `gh api`/`gh pr view` 的原始字段保存。

## 已知约束（来自回归测试）

- `scripts/quickcheck.sh` → QuickCheck 必须 fail-closed。
- `packages/engine/tests/skills/harness-v5-ci-checks.test.ts` → Harness V5 CI checks 不得回退。
- `tests/contract-e2e-extractor.test.ts` → 合同 E2E 提取不得回退。
- `packages/brain/src/__tests__/integration/golden-path.integration.test.js` → Brain Golden Path 不得回退。
- `[累积FR]` 本 line 暂无历史；context-manifest unavailable。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 仅收敛既有 Draft PR #4457：整合冻结 main、处置 33 个冲突路径、收敛冻结 77 条 CodeQL annotation、恢复 exact-head CI。 |
| NFR（做得多好） | 每个 subject 用不可变 ID/SHA/路径枚举；任何遗漏、重复、SHA 漂移或证据不可得均 fail-closed。 |
| Invariant（永不违反） | 不新建 PR、不 merge、不 deploy、不 auto-merge、不 dismiss、不弱化检查/保护/扫描、不删测试、不伪造 receipt；atomic truth 不变。 |
| 判定点（怎么知道） | 见判定点登记表。 |
| 保质期（何时过期） | PR head 改变即使旧 exact-head CI/evaluator 证据失效；冻结输入本轮不随 main 前进改变。 |
| 死亡告警（停了谁知道） | verifier/required check 非零或非 SUCCESS 立即阻塞 judge，并把 subject 与失败原因写入 evidence。 |
| 失败语义（挂了怎么办） | 所有未知分类、API 不可达、清单不等、状态越界均拦截；只允许在同一冻结输入上幂等重跑。 |
| 效果确认（已发≠已生效） | 真 Git 图、真 check-run annotations、真 GitHub PR/check/deployment 状态及真实回归 exit code 交叉验证。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| 冲突总数口径 | A. content only；B. unique unresolved paths | B. 33 unique paths，并独立记录 content=32、non_textual=1 | controller machine facts 已拍板 | 漏掉 modify/delete 路径 |
| 77 告警身份 | A. repo-wide open alerts；B. check-run annotations | B. check-run `90774353140` 的 77 条 annotation，以 canonical tuple 枚举 | controller 已冻结 run/check/head/hash | 漏修或越界扩大扫描 |
| required checks 身份 | A. 名称模糊匹配；B. exact context 集合 | B. 三个 context 完全相等并核 strict=true | branch protection 冻结证据 | 旧/旁路检查假绿 |
| 无外部副作用归因 | A. 只看最终状态；B. 基线+时间窗+ref/SHA/run 标识 | B. mutation 前基线至 evaluator 结束的闭区间审计 | 能区分既有对象与本任务新动作 | 偷建 PR、merge 或 deploy 未被发现 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 冻结 identity/hash 不符 | 非零退出，禁止整合 | 是，只读重取 | 无 |
| 冲突/告警 subject 缺失或重复 | 输出具体 subject 后非零退出 | 是 | 无 |
| CI 未终态或 head 漂移 | 旧结果作废，对新 final head 重跑 | 是 | 无 |
| 发现新 PR/merge/deploy | 立即阻塞，保留原始 API 证据 | 否，需外部处置 | 无 |

### 输入对抗面

N/A — 不新增对外 agent；GitHub annotation/message 均只作不可信数据保存与结构化比较，不执行其文本。

## 冻结身份与枚举

冻结证据必须先生成不可变 manifest：`evidence/frozen-conflicts.json`、`evidence/codeql-freeze.json`、`evidence/required-checks-freeze.json`。三份文件均使用 canonical JSON（对象 key 排序、数组按本节 subject key 排序、UTF-8、末尾单换行）计算 SHA-256；verifier 必须把实际枚举的每个 subject 及 canonical hash 写入输出，禁止只做 JSON 可解析、数组长度或源码字符串检查。

33 路径的可执行 oracle 合同冻结在 `conflict-oracle-manifest.json`。canonical 算法为：`subjects` 按 ASCII `path` 升序（`a.path < b.path`）排序，递归按对象 key 排序，随后无空白 `JSON.stringify`；语义 SHA-256 固定为 `e02ab04b2ae86a81a62effd9e63bbf552f9f1fb883c25fe7f57d0fd378797f4d`。该文件必须恰有 33 个唯一 path、33 个唯一 `C01..C33` oracle_id；每行 `cwd` 非空、`argv` 为完整非空 argv 数组、`expected_observation` 同时声明 `exit_code=0` 和业务观察。`conflicts` verifier 必须对合同 manifest 与 `evidence/conflict-resolution.json` 的 `path/oracle_id/cwd/argv/expected_observation` 做 exact-set 深比较，并逐行真实 spawn；禁止 generator 在 ledger 中另行发明命令。

### Git 与 CodeQL

- PR head：`8f2137d0f5ad7091699f42635ea76c35e0765bd9`
- main：`264482fadd87dc8bf6e7d4534c156ee28e276ccf`
- merge-base：`bf7edb8d6a168768b9a03e1fef32c943f790446b`
- CodeQL workflow run：`30512131637`
- aggregate check-run：`90774353140`
- check-run head：`8f2137d0f5ad7091699f42635ea76c35e0765bd9`
- annotations：77（critical=7、high=59、medium=11）
- annotation canonical JSON semantic SHA-256：`7aeb85fabda8200a7490355820156ec31156ea1b8cb4218b85df0be6ded74ec7`
- details：`https://github.com/perfectuser21/cecelia/runs/90774353140`

Annotation 的 subject key 固定为
`sha256(path + "\0" + start_line + "\0" + end_line + "\0" + annotation_level + "\0" + title + "\0" + message)`；
按 subject key 排序后写入 `evidence/codeql-freeze.json`，必须 77 个且无重复。严重度映射以冻结 annotation 的规则 metadata 为准，禁止从 `failure/warning` 猜 critical/high。
每条 CodeQL oracle 的输出必须包含 `subject_key/path/start_line/end_line/rule/severity/disposition/recheck_check_run_id/recheck_head_sha/recheck_result`，否则该 subject 视为未验证。

### required checks

- branch protection `strict=true`
- exact contexts（排序后逐字相等）：`Harness V5 Gate Passed`、`Smoke Glob Runner Passed`、`ci-passed`
- normalized SHA-256：`82ae1f3d9c9f0b17308ab4dcdbc792965ae9ccf37cfb98e3314b6dfc5da86b0a`

required-check subject 定义为 `context + "\0" + final_head_sha`。每个 oracle 必须逐条输出三个 subject 的 `context/check_run_id/check_suite_id/head_sha/status/conclusion/details_url`；只检查聚合 CI 状态或只比较 context 数量不合格。

### 33 个冲突路径与处置

处置类别定义：`semantic-merge`=以三方 base/PR/main 做语义合并，保留 PR 累计 Kernel Harness 行为及 main 新约束，并运行表中 oracle；`delete-with-proof`=遵循 main 删除，同时将仍需保留的 Sprint 验收迁入本 sprint 证据，不恢复根 `DoD.md`。每行必须在 `evidence/conflict-resolution.json` 中有且仅有一条同路径记录，含 base/ours/theirs blob、类别、理由、验证命令及 exit code。

| # | 唯一路径 | 类型 | 固定处置 | 固定 oracle_id（完整 cwd/argv/观察见合同 manifest） |
|---:|---|---|---|---|
| 1 | `.brain-versions` | content | semantic-merge | `C01` |
| 2 | `.github/workflows/ci.yml` | content | semantic-merge | `C02` |
| 3 | `DEFINITION.md` | content | semantic-merge | `C03` |
| 4 | `DoD.md` | modify/delete | delete-with-proof | `C04` |
| 5 | `docker/cecelia-runner/entrypoint.sh` | content | semantic-merge | `C05` |
| 6 | `package-lock.json` | content | semantic-merge | `C06` |
| 7 | `packages/brain/DEFINITION.md` | content | semantic-merge | `C07` |
| 8 | `packages/brain/config/fleet-node-profiles.json` | content | semantic-merge | `C08` |
| 9 | `packages/brain/package-lock.json` | content | semantic-merge | `C09` |
| 10 | `packages/brain/package.json` | content | semantic-merge | `C10` |
| 11 | `packages/brain/scripts/fleet-worker/attempt-runner.cjs` | content | semantic-merge | `C11` |
| 12 | `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs` | content | semantic-merge | `C12` |
| 13 | `packages/brain/scripts/fleet-worker/fleet-rollout.sh` | content | semantic-merge | `C13` |
| 14 | `packages/brain/scripts/fleet-worker/fleet-rollout.test.sh` | content | semantic-merge | `C14` |
| 15 | `packages/brain/scripts/fleet-worker/fleet-worker.cjs` | content | semantic-merge | `C15` |
| 16 | `packages/brain/scripts/fleet-worker/install-fleet-worker.sh` | content | semantic-merge | `C16` |
| 17 | `packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh` | content | semantic-merge | `C17` |
| 18 | `packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.sh` | content | semantic-merge | `C18` |
| 19 | `packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh` | content | semantic-merge | `C19` |
| 20 | `packages/brain/src/__tests__/integration/golden-path.integration.test.js` | content | semantic-merge | `C20` |
| 21 | `packages/brain/src/orchestrator/fleet-node/node-profile.js` | content | semantic-merge | `C21` |
| 22 | `packages/brain/src/orchestrator/fleet-node/node-profile.test.js` | content | semantic-merge | `C22` |
| 23 | `packages/brain/src/orchestrator/remote-bridge-transport.js` | content | semantic-merge | `C23` |
| 24 | `packages/brain/src/orchestrator/remote-bridge-transport.test.js` | content | semantic-merge | `C24` |
| 25 | `packages/brain/vitest.config.js` | content | semantic-merge | `C25` |
| 26 | `packages/engine/tests/launcher/claude-launch.test.ts` | content | semantic-merge | `C26` |
| 27 | `packages/workflows/skills/harness-contract-proposer/SKILL.md` | content | semantic-merge | `C27` |
| 28 | `packages/workflows/skills/harness-contract-reviewer/SKILL.md` | content | semantic-merge | `C28` |
| 29 | `packages/workflows/skills/harness-controller/SKILL.md` | content | semantic-merge | `C29` |
| 30 | `packages/workflows/skills/harness-evaluator/SKILL.md` | content | semantic-merge | `C30` |
| 31 | `packages/workflows/skills/harness-planner/SKILL.md` | content | semantic-merge | `C31` |
| 32 | `packages/workflows/skills/harness-report/SKILL.md` | content | semantic-merge | `C32` |
| 33 | `tests/contract-e2e-extractor.test.ts` | content | semantic-merge | `C33` |

## Golden Path

[冻结身份] → [33 路径逐项处置] → [77 annotation 逐项收敛] → [回归与 atomic truth] → [exact-head CI] → [最终 SHA evaluator] → [人工审阅门]

### Step 1: 冻结不可变输入
**来源**: `[FROM_PRD]` — Golden Path 1；controller machine facts。
**可观测行为**: verifier 真读 Git object、check-run annotations 与 branch protection，逐字段核对上节全部身份和枚举；stdout/evidence 明列 33 个 conflict path、77 个 annotation subject key、三个 required-check subject，不接受仅计数或 JSON parse。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs freeze
```
**硬阈值**: SHA/ID/hash 完全相等；冲突 total=33/content=32/non_textual=1；annotation=77/7/59/11；required contexts exact-set 且 strict=true。上述命令非零即阻断后续步骤。

### Step 2: 处置全部 33 个冲突路径
**来源**: `[FROM_PRD]` — Golden Path 2；controller 要求每个 oracle 枚举 subject。
**可观测行为**: resolution ledger 的路径集合与合同 manifest exact-set 相等，33 行无重复、无未处置；每行的 `path/oracle_id/cwd/argv/expected_observation` 与语义哈希 `e02ab04b2ae86a81a62effd9e63bbf552f9f1fb883c25fe7f57d0fd378797f4d` 深比较后，输出 base/ours/theirs/final blob、处置、真实 exit_code/log_tail；禁止仅 JSON parse、文件存在或源码字符串检查。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs conflicts
```
**硬阈值**: 33/33、content=32、modify/delete=1、unresolved=0、oracle exit_code 全 0、merge-tree 对最终树无 unresolved entry；上述命令执法。

### Step 3: 收敛全部 77 条冻结 CodeQL annotation
**来源**: `[FROM_PRD]` — Golden Path 3；controller frozen CodeQL facts。
**可观测行为**: disposition ledger 对冻结 manifest 的 77 个 subject key exact-set 覆盖，每条逐项输出 path/line/rule/severity/classification/disposition/recheck check/head/result；真实问题修复，范围外/误报仅留证且不得 dismiss。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs codeql
```
**硬阈值**: exact subjects=77、critical=7/high=59/medium=11、unclassified=0、dismissed=0、scan scope hash 未变、新 final-head CodeQL 无相同未解决 subject；上述命令执法。

### Step 4: 回归与诚实状态
**来源**: `[FROM_PRD]` — 验收计划 3-5。
**可观测行为**: QuickCheck fail-closed、node:test 双登记、OKR in-process `cecelia_test`、migration 369-381、上一轮四项 blocker 及冲突表 33 个 path 各自命名的行为 oracle 真跑；每个 subject 输出真实 argv/interpreter/exit_code/log_tail；atomic truth 不变。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs regressions
```
**硬阈值**: 每个命名 oracle 均记录 argv/interpreter/exit_code=0/log_tail；`schema_valid=true`、`proof_complete=false`、`atomic_cutover_ready=false`、`atomic_progress="0/99"`；上述命令执法。

### Step 5: exact-head required checks
**来源**: `[FROM_PRD]` — Golden Path 4、验收计划 6。
**可观测行为**: 逐项枚举 `ci-passed`、`Harness V5 Gate Passed`、`Smoke Glob Runner Passed` 的 check-run/check-suite，head SHA 全等于同一 final PR head，结论 SUCCESS。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs exact-head
```
**硬阈值**: contexts exact-set、missing=failed=stale=duplicate=0、strict=true、head 读取前后不变；上述命令执法。

### Step 6: evaluator 在最终 SHA 真跑
**来源**: `[FROM_PRD]` — Golden Path 5。
**可观测行为**: evaluator receipt 顶层及每条 behavior 都有真实 `exit_code/log_tail`，subject 与 final SHA 可追溯。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs evaluator
```
**硬阈值**: 顶层/逐项 exit_code=0、所有 evidence_sha 唯一等于 final head、目标解释器启动证据存在；上述命令执法。

### Step 7: 无新 PR/no-merge/no-deploy 后停在人工审阅门
**来源**: `[FROM_PRD]` — 验收计划 7；controller 要求定义审计基线/时间窗/归因。
**可观测行为**: `evidence/audit-baseline.json` 必须在首次 fetch/merge/cherry-pick/push 或任何 GitHub mutation 前生成；其 `run_id/attempt_id/task_id` 必须从实际 generator 的 authoritative task bundle 或签名 execution receipt 动态读取并逐字保存，不得从合同正文、历史 proposer/reviewer 或环境默认值复制。基线另记录 `audit_start_utc`、实际 GitHub actor、target ref、当时全部 open PR number/head、#4457 状态、main SHA、deployments 最大 id/created_at；每次 mutation receipt 保存同一 generator runtime lineage；`audit-end.json` 在 evaluator 后记录 `audit_end_utc` 与 evaluator 自己的 authoritative execution receipt lineage。`review-gate` 必须让 baseline 与 mutation receipts exact-match generator 权威 lineage，让 evaluator receipt exact-match evaluator 权威 lineage，并验证 task_id=`f21957f6-2ae5-4db3-822e-90c3f474fc19`；任何不等、复用 proposer lineage或缺失即 FAIL。闭区间 `[audit_start_utc,audit_end_utc]` 内分页枚举 PR、merge commit、auto-merge mutation、deployments，以实际 actor 加 target ref/final SHA/runtime lineage/task/sprint marker 的并集归因本任务；归因集合不得含 pull_request.created、merged/auto_merge、deployment。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs review-gate
```
**硬阈值**: baseline 创建时间早于首个 mutation；#4457 `OPEN/isDraft=true/autoMergeRequest=null/mergedAt=null`，headRefName 固定；main 不包含 final head；区间内逐项枚举后归因的新 PR、merge、auto-merge、任意 environment deployment 均为 0；所有 REST 分页完整且区间端点明确。上述命令执法。

## 接缝清单

- [接缝×2] 冻结 check-run/annotations：同一 ID 真读两次并比较 canonical hash；不一致判 FLAKY。
- [接缝×2] final-head checks/PR 状态：同一 final SHA 真读两次；不一致判 FLAKY。
- 分支整合是非幂等写动作，只执行一次；以真实 Git 图和 33 路径 ledger 复查。

## 真实调用方请求 shape

N/A — 不新增设备/agent API；GitHub CLI 使用现有认证，不把 token 写入合同或 evidence。

## 未覆盖真实链路清单

（本合同无 force/stub/假数据/mock 豁免，N/A）

## 禁 mock 边清单

- 冻结 PR/main Git object ↔ `git merge-tree`/最终 Git 图。
- 33 个冲突路径 ↔ 各真实相邻模块及真实回归命令。
- check-run `90774353140` ↔ GitHub annotations API。
- PR final head ↔ branch protection/required check runs/deployments API。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: ledger 注入未知路径、重复 annotation subject、错误 check context。
- 重复提交: 同一 final SHA 重跑 verifier，确认不复用旧 head 或重复计数。
- 中途中断: CI 未终态、分页中断、GitHub API 限流时必须 fail-closed。
- 边界值: 32 content + 1 modify/delete、76/78 annotations、check 同名但 head 不同。
发现分级: P0/P1 阻塞 merge；P2/P3 记录 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR="${SPRINT_DIR:-sprints/07301245-kernel-pr4457-refresh}"
REPO="perfectuser21/cecelia"
PR=4457
START_SHA=$(gh pr view "$PR" --repo "$REPO" --json headRefOid -q .headRefOid)
test -n "$START_SHA"
for phase in freeze conflicts codeql regressions exact-head evaluator review-gate; do
  node "$SPRINT_DIR/scripts/verify-pr4457-evidence.mjs" "$phase" --expected-head "$START_SHA"
done
END=$(gh pr view "$PR" --repo "$REPO" --json number,state,isDraft,autoMergeRequest,mergedAt,headRefName,headRefOid)
echo "$END" | jq -e --arg sha "$START_SHA" '.number==4457 and .state=="OPEN" and .isDraft==true and .autoMergeRequest==null and .mergedAt==null and .headRefName=="cp-kernel-phase5b-a1-review-fixes" and .headRefOid==$sha'
echo "Golden Path exact-head 验收通过 sha=$START_SHA"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 冻结身份 | `tests/pr4457-contract.test.ts` | 冻结身份与全部 subject 精确匹配 | verifier/evidence 尚未实现 |
| 冲突处置 | `tests/pr4457-contract.test.ts` | 全部 33 个冲突路径完成行为验证 | manifest exact-set/ledger/verifier 尚未实现 |
| CodeQL | `tests/pr4457-contract.test.ts` | 全部 77 条 CodeQL annotation 收敛 | ledger/verifier 尚未实现 |
| exact-head | `tests/pr4457-contract.test.ts` | 三个 required checks 绑定最终 SHA | verifier 尚未实现 |
| 副作用审计 | `tests/pr4457-contract.test.ts` | 审计窗内无新 PR 无 merge 无 deploy | baseline/verifier 尚未实现 |
