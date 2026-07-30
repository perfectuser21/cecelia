# Sprint Contract Draft (Round 15)

覆盖父路「Draft PR #4457 累计冲突与 CodeQL 收敛」第 1-5 步。

## 合同 notes

- Round 12 采用 controller 的权威 machine facts，消除旧版 `32/33` 与 CodeQL 口径歧义：总冲突路径固定为 33（32 个 content + `DoD.md` 1 个 modify/delete）；77 固定指 check-run `90774353140` 的 PR-new-alert annotations。
- 保持此前已通过项：两个 ARTIFACT oracle 使用内容/schema/身份/exact-set 与七阶段真实行为断言；33 路径完整映射冻结为合同 manifest。仅修订 C25/C27/C28/C29 为可解析且非 skipped 的真实行为 oracle，并重算语义 digest。
- Round 13 保持 8 条测试、33 路径 manifest/digest、77 个 CodeQL subject、3 个 required context、动态 lineage 与副作用阈值不变，并修复 Round 12 的阶段循环依赖：七个 verifier phase 分属四个 actor/time boundary，禁止 generator 在 push 前伪造 exact-head/evaluator 结果。
- Round 15 保留上述非循环协议，并把它变成机械合同：8 个既有测试用例内分别加入错误 stage、错误 actor role、缺前置 receipt、伪造 exit/log、digest 不符、跨阶段 lineage 复用、倒序时间戳等隔离负向场景；每个场景必须同时得到非零退出与稳定错误码，缺实现文件本身不得冒充通过。
- `exact-head-receipt.json` 的唯一可信 producer 是 CI runner；CI 仅可在只读 exact-head verifier 返回 0，且 stdout/evidence digest、三个 required check-run、final-head CodeQL、final SHA 与 CI runtime lineage 全部匹配后签名/写出 receipt。verifier 永不创建 receipt。
- 33 行 manifest 全部显式冻结 `stage=generator-pre-push`。C02 已从 post-push exact-head 改为 pre-push 本地 workflow 行为 oracle；C02/C04/C25/C27/C28/C29 argv 均显式带 `--stage generator-pre-push`。
- manifest 测试在核对冻结 schema、33 subject、argv 与 digest 前，必须先跨过实现产出的 `generator-pre-push/conflicts` verifier/evidence 边界；因此实现前固定为 `failed=8, passed=0, total=8`。
- durable contract 不保存任何 proposer/reviewer 的具体 `run_id` 或 `attempt_id`。各阶段必须从该阶段 authoritative task bundle 或签名 execution receipt 读取命名字段 `runtime_lineage.run_id`、`runtime_lineage.attempt_id`、`runtime_lineage.task_id`、`runtime_lineage.role`、`runtime_lineage.stage`，基线与 mutation receipt 保存 generator lineage，终验保存 evaluator lineage。
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

33 路径的可执行 oracle 合同冻结在 `conflict-oracle-manifest.json`。canonical 算法为：`subjects` 按 ASCII `path` 升序（`a.path < b.path`）排序，递归按对象 key 排序，随后无空白 `JSON.stringify`；语义 SHA-256 固定为 `ed69d150c7e7f0ae4e5b759964e7cbbb4f35ee489ad3e5e62ae5cb114133bb01`。该文件必须恰有 33 个唯一 path、33 个唯一 `C01..C33` oracle_id；每行必须显式为 `stage=generator-pre-push`，`cwd` 非空、`argv` 为完整非空 argv 数组、`expected_observation` 同时声明 `exit_code=0` 和业务观察。`conflicts` verifier 必须对合同 manifest 与 `evidence/conflict-resolution.json` 的 `path/oracle_id/stage/cwd/argv/expected_observation` 做 exact-set 深比较，并逐行在该 stage 真实 spawn；generator-pre-push 禁止执行 post-push oracle，禁止 generator 在 ledger 中另行发明命令。

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
generator-pre-push 的每条 CodeQL disposition 必须包含 `subject_key/path/start_line/end_line/rule/severity/disposition`；ci-exact-head receipt 必须用同一 77-subject exact-set 补齐 `recheck_check_run_id/recheck_head_sha/recheck_result`。controller-review-gate 将两段按 `subject_key` 一对一 join；任一侧缺失、重复或集合不同均视为未验证。

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

## 阶段、actor 与 receipt 协议

verifier 是只读验证器，只能消费已有事实与 receipt，禁止创建、改写或补签 `push-receipt.json`、`exact-head-receipt.json`、`evaluator-receipt.json`、`audit-end.json`。每次调用必须显式给出 `--stage`；stage、执行 role、authoritative lineage、前置 receipt 或 evidence 不符时必须非零退出并输出稳定错误码。

| stage | 唯一 actor/time boundary | 允许 phase | 必需前置 | 本阶段输出 |
|---|---|---|---|---|
| `generator-pre-push` | generator，首次 mutation 基线之后、最终 push 之前 | `freeze conflicts codeql regressions` | generator authoritative task bundle/签名 execution receipt；`audit-baseline.json` | 四 phase evidence；不得声称 exact-head/evaluator PASS |
| `ci-exact-head` | CI runner（`exact-head-receipt.json` 唯一可信 producer），在 generator 最终 push receipt 之后 | `exact-head`（含 final-head CodeQL recheck） | `push-receipt.json`，其 `final_head_sha` 等于 CI 实际 head；generator lineage exact-match baseline/mutation receipt | CI 先运行只读 verifier；仅当其 exit=0，stdout/evidence digest、三项 check-run、final-head CodeQL、final SHA、CI lineage 全匹配后签名/写出 `exact-head-receipt.json` |
| `evaluator-receipt` | 独立 evaluator，在 exact-head SUCCESS 之后 | `evaluator` | `exact-head-receipt.json` SUCCESS；evaluator 自己的 authoritative task bundle/签名 receipt，且 role/stage 与 generator 不同 | 由独立 evaluator runner 产出的 `evaluator-receipt.json`；verifier 只验证，不创建 |
| `controller-review-gate` | controller，在 evaluator receipt 与 audit-end 均已存在之后 | `review-gate` | exact-head、evaluator receipt、`audit-end.json`；各自 runtime lineage exact-match 对应权威来源 | 只读 gate verdict，停在人工审阅门 |

receipt 必须含 `schema_version/stage/actor_role/runtime_lineage/{run_id,attempt_id,task_id,role,stage}/final_head_sha/created_at_utc`；phase receipt 另含 `prerequisite_receipt_sha256/evidence_sha256/stdout_sha256/status/exit_code`。`runtime_lineage` 只从当前阶段权威 task bundle 或签名 execution receipt 注入，静态合同不保存任何 proposer/reviewer UUID。不同 stage 的 `run_id + attempt_id + role + stage` 必须不同；任何 cross-stage lineage reuse、缺 receipt、错误 role/stage、SHA/digest 不等、receipt 声称 `exit_code=0` 但缺真实逐 subject 执行日志，都必须非零退出。verifier 用 receipt canonical digest 与原始日志/事实重算结果，不信任 ledger 自报的 `exit_code`，且 verifier 不创建 exact-head/evaluator receipt。

### 负向协议与稳定错误码

以下负向场景在既有 8 个测试用例内隔离构造，不能新增第 9 个测试。每项必须同时断言 `exit_code != 0` 与对应稳定错误码；仅因 verifier 文件不存在、Node 加载失败或参数解析崩溃而非零不算通过：

| 场景 | 稳定错误码 |
|---|---|
| phase 与 `--stage` 不匹配 | `ERR_STAGE_MISMATCH` |
| actor role 不是该 stage 唯一允许角色 | `ERR_ACTOR_ROLE` |
| push/exact-head/evaluator prerequisite receipt 缺失 | `ERR_PREREQUISITE_RECEIPT` |
| ledger 自报 exit_code=0 但逐 subject argv/log 缺失或不符 | `ERR_EVIDENCE_FABRICATED` |
| manifest/evidence/stdout/prerequisite digest 不匹配 | `ERR_DIGEST_MISMATCH` |
| 不同 stage 复用同一 runtime lineage | `ERR_LINEAGE_REUSE` |
| receipt 时间戳倒序 | `ERR_CHRONOLOGY_REVERSED` |

## Golden Path

[冻结身份] → [33 路径逐项处置] → [77 annotation 逐项收敛] → [回归与 atomic truth] → [exact-head CI] → [最终 SHA evaluator] → [人工审阅门]

### Step 1: 冻结不可变输入
**来源**: `[FROM_PRD]` — Golden Path 1；controller machine facts。
**可观测行为**: verifier 真读 Git object、check-run annotations 与 branch protection，逐字段核对上节全部身份和枚举；stdout/evidence 明列 33 个 conflict path、77 个 annotation subject key、三个 required-check subject，不接受仅计数或 JSON parse。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs freeze --stage generator-pre-push
```
**硬阈值**: SHA/ID/hash 完全相等；冲突 total=33/content=32/non_textual=1；annotation=77/7/59/11；required contexts exact-set 且 strict=true。上述命令非零即阻断后续步骤。

### Step 2: 处置全部 33 个冲突路径
**来源**: `[FROM_PRD]` — Golden Path 2；controller 要求每个 oracle 枚举 subject。
**可观测行为**: resolution ledger 的路径集合与合同 manifest exact-set 相等，33 行无重复、无未处置；每行的 `path/oracle_id/stage/cwd/argv/expected_observation` 与语义哈希 `ed69d150c7e7f0ae4e5b759964e7cbbb4f35ee489ad3e5e62ae5cb114133bb01` 深比较后，输出 base/ours/theirs/final blob、处置、真实 exit_code/log_tail；全部行为 oracle 在 `generator-pre-push` 执行，禁止仅 JSON parse、文件存在或源码字符串检查。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs conflicts --stage generator-pre-push
```
**硬阈值**: 33/33、content=32、modify/delete=1、unresolved=0、oracle exit_code 全 0、merge-tree 对最终树无 unresolved entry；上述命令执法。

### Step 3: 收敛全部 77 条冻结 CodeQL annotation
**来源**: `[FROM_PRD]` — Golden Path 3；controller frozen CodeQL facts。
**可观测行为**: disposition ledger 对冻结 manifest 的 77 个 subject key exact-set 覆盖，每条逐项输出 path/line/rule/severity/classification/disposition；真实问题修复，范围外/误报仅留证且不得 dismiss。final-head recheck 字段由后续 ci-exact-head receipt 以同一 subject key 补齐。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs codeql --stage generator-pre-push
```
**硬阈值**: exact subjects=77、critical=7/high=59/medium=11、unclassified=0、dismissed=0、scan scope hash 未变；本阶段只完成冻结 subject disposition，不声称 final-head recheck 已完成。final-head CodeQL recheck 由 `ci-exact-head` 执法。

### Step 4: 回归与诚实状态
**来源**: `[FROM_PRD]` — 验收计划 3-5。
**可观测行为**: QuickCheck fail-closed、node:test 双登记、OKR in-process `cecelia_test`、migration 369-381、上一轮四项 blocker 及冲突表 33 个 path 各自命名的行为 oracle 真跑；每个 subject 输出真实 argv/interpreter/exit_code/log_tail；atomic truth 不变。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs regressions --stage generator-pre-push
```
**硬阈值**: 每个命名 oracle 均记录 argv/interpreter/exit_code=0/log_tail；`schema_valid=true`、`proof_complete=false`、`atomic_cutover_ready=false`、`atomic_progress="0/99"`；上述命令执法。

### Step 5: exact-head required checks
**来源**: `[FROM_PRD]` — Golden Path 4、验收计划 6。
**可观测行为**: CI runner 在最终 push receipt 后逐项枚举 `ci-passed`、`Harness V5 Gate Passed`、`Smoke Glob Runner Passed` 的 check-run/check-suite，head SHA 全等于 receipt 与 CI 实际 head；同时在该 final head 重新读取 CodeQL，确认冻结 77 subjects 已处置且无相同 unresolved subject。缺 push receipt、receipt SHA 与 CI head 不等或 generator 在 push 前调用均 FAIL。只读 verifier 成功后，CI runner 才可把 verifier stdout digest、evidence digest、三项 check-run、CodeQL、final SHA 与 CI lineage 签入并产出 `exact-head-receipt.json`。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs exact-head --stage ci-exact-head --receipt "$SPRINT_DIR/evidence/push-receipt.json"
```
**硬阈值**: contexts exact-set、missing=failed=stale=duplicate=0、strict=true、head 读取前后不变；final-head CodeQL recheck head 与 final head 相等且 unresolved frozen subject=0；verifier 只读退出 0 后由 CI runner 独立签名/写出 `exact-head-receipt.json`，verifier 本身不得写 receipt。

### Step 6: evaluator 在最终 SHA 真跑
**来源**: `[FROM_PRD]` — Golden Path 5。
**可观测行为**: 独立 evaluator 在 exact-head SUCCESS 后真跑合同并产生 receipt；verifier 只读验证该 receipt，不得自行创建。receipt 顶层及每条 behavior 都有真实 `argv/exit_code/log_tail`，subject 与 final SHA 可追溯，evaluator lineage 不得复用 generator/CI lineage。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs evaluator --stage evaluator-receipt --receipt "$SPRINT_DIR/evidence/evaluator-receipt.json"
```
**硬阈值**: exact-head prerequisite digest 匹配；顶层/逐项 exit_code=0、所有 evidence_sha 唯一等于 final head、目标解释器启动证据存在；receipt producer role=evaluator 且 lineage 独立；上述命令执法。

### Step 7: 无新 PR/no-merge/no-deploy 后停在人工审阅门
**来源**: `[FROM_PRD]` — 验收计划 7；controller 要求定义审计基线/时间窗/归因。
**可观测行为**: `evidence/audit-baseline.json` 必须在首次 fetch/merge/cherry-pick/push 或任何 GitHub mutation 前生成；其 `runtime_lineage.{run_id,attempt_id,task_id,role,stage}` 必须从实际 generator 的 authoritative task bundle 或签名 execution receipt 动态读取并逐字保存，不得从合同正文、历史 proposer/reviewer、默认值或另一阶段复制。基线另记录 `audit_start_utc`、实际 GitHub actor、target ref、当时全部 open PR number/head、#4457 状态、main SHA、deployments 最大 id/created_at；每次 mutation receipt 保存同一 generator runtime lineage；`audit-end.json` 在 evaluator 后记录 `audit_end_utc` 与 evaluator 自己 task bundle/签名 receipt 的同名 runtime_lineage 字段。`review-gate` 必须让 baseline 与 mutation receipts exact-match generator 权威 lineage，让 audit-end 与 evaluator receipt exact-match evaluator 权威 lineage，并验证 task_id=`f21957f6-2ae5-4db3-822e-90c3f474fc19`、role/stage 符合当前阶段；任何不等、跨阶段复用或缺失即 FAIL。闭区间 `[audit_start_utc,audit_end_utc]` 内分页枚举 PR、merge commit、auto-merge mutation、deployments，以实际 actor 加 target ref/final SHA/runtime lineage/task/sprint marker 的并集归因本任务；归因集合不得含 pull_request.created、merged/auto_merge、deployment。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs review-gate --stage controller-review-gate --exact-head-receipt "$SPRINT_DIR/evidence/exact-head-receipt.json" --evaluator-receipt "$SPRINT_DIR/evidence/evaluator-receipt.json" --audit-end "$SPRINT_DIR/evidence/audit-end.json"
```
**硬阈值**: controller role/stage 正确；机械验证 `audit_start <= generator evidence <= push < exact-head < evaluator <= audit_end`；exact-head 与 evaluator receipt 的 prerequisite/evidence/stdout digest 链完整、actor/stage 正确且 final SHA 唯一相同；baseline/mutation exact-match generator lineage，audit-end exact-match evaluator lineage，跨 stage lineage 不复用；#4457 `OPEN/isDraft=true/autoMergeRequest=null/mergedAt=null`，headRefName 固定；main 不包含 final head；区间内逐项枚举后归因的新 PR、merge、auto-merge、任意 environment deployment 均为 0；所有 REST 分页完整且区间端点明确。上述命令执法。

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
# 本块由 controller final-e2e 执行；前三 actor/time boundary 的 receipt 必须已存在。
# review-gate 只读消费并重算完整 receipt/evidence digest 链，禁止在错误 actor 重跑前序 phase。
node "$SPRINT_DIR/scripts/verify-pr4457-evidence.mjs" review-gate --stage controller-review-gate --exact-head-receipt "$SPRINT_DIR/evidence/exact-head-receipt.json" --evaluator-receipt "$SPRINT_DIR/evidence/evaluator-receipt.json" --audit-end "$SPRINT_DIR/evidence/audit-end.json" --expected-head "$START_SHA"
END=$(gh pr view "$PR" --repo "$REPO" --json number,state,isDraft,autoMergeRequest,mergedAt,headRefName,headRefOid)
echo "$END" | jq -e --arg sha "$START_SHA" '.number==4457 and .state=="OPEN" and .isDraft==true and .autoMergeRequest==null and .mergedAt==null and .headRefName=="cp-kernel-phase5b-a1-review-fixes" and .headRefOid==$sha'
echo "Golden Path exact-head 验收通过 sha=$START_SHA"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| manifest 实现边界 | `tests/pr4457-contract.test.ts` | 33 路径 oracle manifest 的 schema 身份 argv 与语义哈希精确匹配 | `conflicts` verifier/evidence 尚未实现；实现前该断言必须失败 |
| 冻结身份 | `tests/pr4457-contract.test.ts` | 冻结身份与全部 subject 精确匹配 | verifier/evidence 尚未实现 |
| 冲突处置 | `tests/pr4457-contract.test.ts` | 全部 33 个冲突路径完成行为验证 | manifest exact-set/ledger/verifier 尚未实现 |
| CodeQL | `tests/pr4457-contract.test.ts` | 全部 77 条 CodeQL annotation 收敛 | ledger/verifier 尚未实现 |
| exact-head | `tests/pr4457-contract.test.ts` | 三个 required checks 绑定最终 SHA | verifier 尚未实现 |
| 副作用审计 | `tests/pr4457-contract.test.ts` | 审计窗内无新 PR 无 merge 无 deploy | baseline/verifier 尚未实现 |

Red 闸硬阈值：实现前执行本 Test Contract 必须精确得到 `total=8, failed=8, passed=0`；任一测试预先通过即禁止进入 Green。
