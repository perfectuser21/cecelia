# Sprint Contract Draft（Round 1）

## 基线与范围

- 执行基线必须先 `git fetch origin main`，再证明 `d37a5e57827900be2651fe39655690238513128f` 是 `origin/main^{commit}` 的祖先；历史 commit `097238c18...` 与 attempt `511c492c...` 仅作证据，不继承批准。
- 范围恰好 B1-B5；复用 HarnessResult `1.0`，不增平行 schema/ledger；`review_required=true`，验绿后停在人工批准前，禁止生产 DB 写、merge、deploy。
- Registry 可达；字段以 PRD 与 current-main 为权威。`context-manifest: unavailable`（端点返回 404）。

## Response Schema（推导来源: PRD字面）

### Endpoint: POST /api/brain/harness/attempts/:attemptId/callback

- 成功：HTTP 200，`{"ok":true}`（可保留既有 `attemptId/deduped`，但不得含敏感字段）。
- 失败顶层 keys 必须恰为 `["error","ok"]`，body 恰为 `{"ok":false,"error":{"key":"<code>","code":"<code>"}}`。
- 冻结错误：400 `invalid_result`；401 `invalid_credential`；404 `attempt_not_found`；409 `scope_conflict|lineage_conflict|digest_conflict`；500 `persistence_failed`；每项 `key===code`，禁 message/stack/secret/transcript。
- `decision.review={outcome,feedback,rubric,binding,digest}`；outcome=`APPROVED|REVISION`；feedback≤50、唯一 id 长 1..64、text 长 1..2000；rubric≤20、唯一 id 长 1..64、整数 score 0..10、max_score=10、evidence 长 0..2000。
- `decision.resolutions` 每项 `{feedback_id,status}`，status=`RESOLVED|UNRESOLVED|DISPUTED`；总 UTF-8 JSON≤262144 bytes。server 拥有 attempt/run/task/round/contract SHA；caller 仅作 equality claim。
- digest 为 canonical SHA-256：对象键递归排序、数组保序、UTF-8 编码，只排除 `decision.review.digest`，server 重算；禁用旧宽松 outcome/verdict、无界 reason/feedback 与 caller authority。

## 真实调用方请求 shape

可信 runner 调用真实 callback：`Authorization: Bearer <attempt callback secret>`、`X-Harness-Lease-Owner: <server lease owner>`、`Content-Type: application/json`；path attempt id 与 HarnessResult v1 `attempt_id` 相等。外部 agent 只获 `BRAIN_RESULT_FILE`，不获 callback secret/lease owner；runner 读取、增补 server-bound attestation 后代为 POST。

## Golden Path

覆盖父路「worker-local result sink 与 feedback lineage」第 1-5 步。

### B1：真实 dispatcher → local/fleet worker-local result sink
**来源**：`[FROM_PRD]` — Golden Path 1。
**行为与阈值**：external launcher 资格由真实 dispatcher 分支机械产生，非 role 白名单。`createDetachedLauncher`（legacy/local）与 `packages/brain/scripts/fleet-worker/attempt-runner.cjs`（Fleet）各在 attempt-owned runtime 下先建 0700 dir/0600 file；以只读 bind 把 `workspace_spec` 保持 server-owned/path-free，以独立可写 bind 只暴露 `/run/cecelia-result/result.json`。`BRAIN_RESULT_FILE` 只给 reviewer 与 dedicated canary 的外部 agent；两者 `expectedOutput` 分别为 reviewer-v1/canary-v1；`spawn:judge` 在 `createDispatcher` 的 in-process 分支，无该变量。可信 runner 在 agent 退出后以 lstat/fstat 校验 ordinary file、owner、nlink=1、containment、≤262144、单次消费，先 unlink 并确认 cleanup，再 POST；attestation 绑定 run+attempt+surface+canonical digest+nonce+`cleanup_outcome=deleted`。拒绝 caller result/workspace path、cross-attempt、stale nonce/capability、surface/mode/run mismatch、unattested receipt、symlink/hardlink/escape/reuse/missing/oversize；success/failure/cancel 的 finally 均清理。CANARY_OK 空 artifacts/checks、null error 不变。
**命令**：Red `bash sprints/07272334-kernel-aeaf5c78/tests/run-behavior.sh B1 red`；mutation `... B1 mutate`（补丁跳过 lstat/nlink，预期 `COUNTERFACTUAL:B1:unsafe_result_file_accepted`）；restore `... B1 restore`；Green `... B1 green`。
**观察**：local-docker 与 fleet-worker 各产生不同 inode/nonce 的 attested receipt；所有负例具名拒绝，三种终态路径无残留。

### B2：HarnessResult 1.0 精确 bounds 与 digest
**来源**：`[FROM_PRD]` — Golden Path 2。
**行为与阈值**：真实 parser/callback 逐项验证每个边界、+1、重复 id、非法 enum、非整数、max_score≠10、binding 与 digest 篡改；canary 空 envelope 保持兼容。
**命令**：Red `bash .../tests/run-behavior.sh B2 red`；mutation `... B2 mutate`（补丁让 canonicalizer 额外排除 outcome，预期 `COUNTERFACTUAL:B2:digest_tamper_accepted`）；restore `... B2 restore`；Green `... B2 green`。
**观察**：合法边界通过；每个越界/篡改均返回具名 invalid_result 或 digest_conflict。

### B3：真实 callback HTTP + PostgreSQL 原子持久化
**来源**：`[FROM_PRD]` — Golden Path 3。
**行为与阈值**：子进程仅绑定已预检的 `TEST_DATABASE_URL` 启动实际 callback router/socket；production stores 建 task/run/attempt，真实 HTTP 覆盖成功及所有冻结 error pair。完整有界 review 与 attestation 写 `harness_attempts.result`；decision-log 只写 `{attempt_id,run_id,task_id,round,contract_sha,digest,outcome}`。同 digest replay 幂等，异 digest 409；按精确 run+attempt 回读。测试在 attempt-result UPDATE 后、decision-log INSERT 前用隔离 test schema trigger/fault 制造真实 PG 失败，断言两写均回滚；响应、日志、DB 零 secret/message/stack/transcript。
**命令**：Red `bash .../tests/run-behavior.sh B3 red`；mutation `... B3 mutate`（安装 test-only decision-log failure trigger，预期 `COUNTERFACTUAL:B3:partial_commit_detected`）；restore `... B3 restore`（DROP trigger + ROLLBACK fixture）；Green `... B3 green`。
**观察**：200/400/401/404/409/500 与 key/code 精确；fault 后本 attempt 两表 count=0。

### B4：server-owned Round 2 feedback lineage
**来源**：`[FROM_PRD]` — Golden Path 4。
**行为与阈值**：真实 route 持久化 Round1 REVISION；`collectGroundTruth` 只取同 run、round=1、contract SHA 精确相等的 reviewer attempt；真实 dispatcher 派 fresh Round2 proposer/reviewer bundle，二者携同一 prior_review，proposer resolutions 对 feedback id 恰好 1:1。实际 legacy 入口点名为 `buildRealDeps→createDetachedLauncher→docker/cecelia-runner/entrypoint.sh::run_provider_contract`，其无历史首轮保持空；Fleet 入口为 `createProductionExecutionTransport→createRemoteBridgeTransport→packages/brain/scripts/fleet-worker/fleet-worker.cjs::POST /harness/attempts→attempt-runner.cjs::launch`。缺历史、stale SHA、unknown/duplicate/missing resolution、concurrent/recovery/cross-run 在 launch 前阻断。
**命令**：Red `bash .../tests/run-behavior.sh B4 red`；mutation `... B4 mutate`（补丁移除 contract SHA predicate，预期 `COUNTERFACTUAL:B4:stale_prior_review_dispatched`）；restore `... B4 restore`；Green `... B4 green`。
**观察**：真实 DB→ground truth→dispatcher 形成 REVISION→APPROVED；负例无新 attempt/launch。

### B5：真实 approvals + GitHub current-head merge gate
**来源**：`[FROM_PRD]` — Golden Path 5。
**行为与阈值**：隔离 PG 创建 evaluator/judge/human 真实行，`defaultPrHeadResolver` 以真实 `gh pr view` 只读 GET 当前 head；四者绑定同 final SHA 才可进入 merge action。新 head 令三份批准一起 stale；review_required 且未批准必须 wait。只有不可逆 `gh merge` 与 production deploy 可 spy：负例 0/0，唯一合法已批准 fixture 1/1；本 sprint 实际执行仍停在批准前，不调用二者。
**命令**：Red `bash .../tests/run-behavior.sh B5 red`；mutation `... B5 mutate`（把 approval SHA 留在旧 head 后再解析新 head，预期 `COUNTERFACTUAL:B5:stale_head_allowed`）；restore `... B5 restore`；Green `... B5 green`。
**观察**：真实 GitHub GET 成功；head 改变后 0/0，完整同 SHA fixture 1/1。

## PostgreSQL fail-closed preflight（B1-B5 同一前置）

每个上述命令都先由 `run-behavior.sh` 执行 dependency proof（`vitest/pg/express` 可加载），再执行 `pg-preflight.mjs`，然后才 import Brain/建行：`TEST_DATABASE_URL` 必填；URL protocol 必须 postgresql、hostname/database 非空；拒绝 cecelia/prod-like、localhost/127.0.0.1/::1/默认 socket/歧义 inet。首次连接执行 READ ONLY transaction，要求 `current_database()` 匹配 `^(test|harness)(_[a-z0-9]+)*$` 且 `inet_server_addr()` 非 null、非 loopback并属于 `TEST_DATABASE_ALLOWED_CIDRS`；禁止 COALESCE local。任一 infra/import/config/DB/network 启动错误标 `FAKE_RED`，不能计 Red；Red 必须非零且含唯一 `BUSINESS_RED:B<N>:<name>`。

## 接缝清单

- `createDispatcher ↔ createDetachedLauncher ↔ spawnDockerDetached ↔ entrypoint.sh`：真 local runner/result inode/callback；禁 mock spawnDetached。
- `remote-bridge-transport ↔ fleet-worker.cjs ↔ attempt-runner.cjs ↔ workspace-manager.cjs`：真 Fleet HTTP、workspace_spec、Docker runtime result file/receipt；禁 mock transport/runner。
- `harness-callback router ↔ attempt-store ↔ PostgreSQL decision log`：真 socket、production stores、真事务；禁 mock pool/store。
- `ground-truth ↔ dispatcher ↔ evaluator/judge/human rows ↔ GitHub resolver`：真 PG/dispatcher/GET；只允许末端 merge/deploy spy。

## 禁 mock 边清单

上述四条接缝全部属于本单被改边，均禁止 mock；尤其禁止 mock pool/store/spawnDetached/transport 或以 parser/mergeGate 纯 helper 代替。

## 未覆盖真实链路清单（Uncovered Real Links）

仅不可逆 GitHub merge 与 production deploy 未真执行、以 0/1 spy 代替；补位人为 controller 在批准后执行。本合同无其他 mock 豁免：真实 GitHub GET、local/fleet runner 与 transport、callback HTTP、PostgreSQL、ground truth、dispatcher、approval records 均必须真验。

## 精确文件、Test Contract 与 Red 纪律

- 实现：`packages/brain/src/orchestrator/{dispatcher.js,execution-contract.js,remote-bridge-transport.js,attempt-store.js,ground-truth.js,derive.js,kernel-handlers.js}`、`packages/brain/src/routes/harness-callback.js`、`packages/brain/scripts/fleet-worker/{fleet-worker.cjs,attempt-runner.cjs}`、`docker/cecelia-runner/entrypoint.sh`、`packages/brain/DEFINITION.md`、`packages/brain/package.json`。
- 真实测试：`packages/brain/src/__tests__/harness-kernel-feedback-lineage.real.test.js`；合同驱动：`sprints/07272334-kernel-aeaf5c78/tests/{harness-kernel-feedback-lineage.contract.test.ts,run-behavior.sh,pg-preflight.mjs,counterfactuals/B1.patch,B2.patch,B4.patch}`。B3/B5 mutation 由测试 fixture 外部改 DB/GitHub head，不加 production force flag。

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 五行为 | `sprints/07272334-kernel-aeaf5c78/tests/harness-kernel-feedback-lineage.contract.test.ts` | `[B1] real result sink`；`[B2] exact HarnessResult bounds`；`[B3] atomic callback`；`[B4] exact Round2 lineage`；`[B5] current-head approvals` | 每个同名业务 assertion 独立 Red；依赖/import/config/DB/network 错均为 FAKE_RED |

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR | 恰好 B1-B5。 |
| NFR | dir 0700/file 0600；JSON≤262144；全链 fail closed/脱敏。 |
| Invariant | workspace 只读且与 sink 分离；server-owned lineage；跨 run/attempt 不串。 |
| 判定点 | N/A，均为 inode、字节、签名、DB、SHA 确定比较。 |
| 保质期 | nonce/capability 到 attempt 终态或 expiry；新 head 使 approval 过期。 |
| 死亡告警 | 具名非零测试；persistence/cleanup 失败记录安全 error code 并告警。 |
| 失败语义 | 校验、持久化、lineage、gate 均拦截；同 digest 幂等，异 digest 冲突。 |
| 效果确认 | 回读文件属性、attestation、两表、fresh bundle、GitHub head 与调用计数。 |

判定点登记：`N/A`。输入对抗面：agent result、callback、Fleet launch body 均不可信；严格 auth/schema/bounds/server binding/attestation/unknown-field rejection。

### 判定点登记表

（本任务无接缝模糊判定点，N/A；安全结果均为确定性比较。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等 | 降级 |
|---|---|---|---|
| sink/callback/lineage/gate 失败 | 拦截并安全 code | 同 digest 是 | 不放行 |

### 输入对抗面

| 输入来源 | 信任等级 | 防护 | 越权拒绝 |
|---|---|---|---|
| agent result/Fleet body/callback | 不可信 | bounds+auth+attestation | server binding+unknown-field reject |

## 已知约束（来自回归测试）与五风险表

- `[回归] dispatcher.test.js` external/in-process 分流；`execution-contract.test.js` workspace_spec/read-only；`attempt-runner.test.cjs` runtime/workspace cleanup；`harness-attempt-callback.test.js` callback receipt；`ground-truth.test.js` SHA；`gates.test.js` human gate。`[累积FR]` 暂无。

| 风险 | 触发 | 观察 | counterfactual | 处置 |
|---|---|---|---|---|
| R1 sink 越权 | workspace/result 混用 | 拒绝且清理 | B1 unsafe file | 分离 mount+attestation |
| R2 schema/digest 漂移 | +1/tamper | strict error | B2 digest tamper | canonical server recompute |
| R3 部分提交 | 第二写失败 | 两表 0 | B3 trigger fault | 单事务 |
| R4 历史串线 | stale/cross-run | launch 0 | B4 stale SHA | 精确 attempt lineage |
| R5 stale merge | head 改变 | merge/deploy 0 | B5 new head | 四方同 SHA |

## E2E 验收

**journey_type**: autonomous　**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
git fetch origin main
MAIN_SHA=$(git rev-parse --verify "origin/main^{commit}")
git merge-base --is-ancestor d37a5e57827900be2651fe39655690238513128f "$MAIN_SHA"
for behavior in B1 B2 B3 B4 B5; do
  bash sprints/07272334-kernel-aeaf5c78/tests/run-behavior.sh "$behavior" green
done
node sprints/07272334-kernel-aeaf5c78/tests/assert-version.mjs
echo "OK: B1-B5 green on $MAIN_SHA; stopped before human approval/merge/deploy"
```

合同保护 `[AI_ADDED]`：`run-behavior.sh` 的 FAKE_RED 分类与 counterfactual restore 是为防基础设施错误冒充业务 Red；不扩展产品行为。
