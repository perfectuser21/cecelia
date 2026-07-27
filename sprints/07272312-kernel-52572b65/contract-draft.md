# Sprint Contract Draft（Round 1）

## 基线、范围与 Response Schema

- 基线：`origin/main=d37a5e57827900be2651fe39655690238513128f`（#4377）；执行前必须 `git fetch origin main` 并绑定该 SHA 或更新 tip，早期 `1dc9d4107`、生产 `087c7fa86`、`71697ea1...` 与 attempt `4a518e11...` 的批准全部 stale。
- 范围：只恢复下列五个行为；复用 HarnessResult `contract_version:"1.0"`，禁止 v2、平行 schema/ledger、自动 merge。`review_required=true` 必须停在人工批准。
- Registry：API/DB/test registry 可达但快照 stale（215h）；按 PRD 字面和 current-main 源码为权威。`context-manifest: unavailable`。
- `POST /api/brain/harness/attempts/:attemptId/callback` 成功保持 `{"ok":true,"attemptId":"<uuid>","deduped":<boolean>}`；错误严格为 `{"ok":false,"error":{"key":"<key>","code":"<code>"}}`，且顶层 keys 完全等于 `["error","ok"]`。
- 错误对：400 `invalid_result/invalid_result`；401 `invalid_credential/invalid_credential`；404 `attempt_not_found/attempt_not_found`；409 `scope_conflict/scope_conflict`、`lineage_conflict/lineage_conflict`、`digest_conflict/digest_conflict`；500 `persistence_failed/persistence_failed`。禁用旧字符串 `attempt not found`、`provider_mismatch:*`、stack/message 反射。
- `decision.review={outcome,feedback,rubric,binding,digest}`；outcome=`APPROVED|REVISION`；feedback≤50，唯一 id 1..64、text 1..2000；rubric≤20，唯一 id 1..64、score 为 0..10 整数、max_score=10、evidence 0..2000；`decision.resolutions≤50`，每项仅 `{feedback_id,status}`，status=`RESOLVED|UNRESOLVED|DISPUTED`。
- `binding={attempt_id,run_id,task_id,round,contract_sha}` 是 client equality claim；server 从 path/attempt/TaskBundle 覆写并逐字段比对。总 UTF-8 JSON ≤262144 bytes。digest=SHA-256(canonical-v1 整份结果)：对象键递归排序、数组保序、UTF-8、只排除 `decision.review.digest`，server 重算。

## 真实调用方请求 shape

生产 runner 调用：`POST /api/brain/harness/attempts/:attemptId/callback`，headers 为 `Authorization: Bearer <attempt callback secret>`、`X-Harness-Lease-Owner: <server lease owner>`、`Content-Type: application/json`；body 为 HarnessResult v1 的 `contract_version,attempt_id,status,summary,artifacts,checks,decision,error,provider_metadata`。不得从 body/caller path 接受 run/task/round/SHA、workspace/result authority。

## Golden Path

覆盖父路「真实执行路径的反馈血缘恢复」第 1-5 步。

### Behavior 1：external launcher 派生结果通道
**来源**：`[FROM_PRD]` — Golden Path 1 与 #4377 correction。  
**行为/阈值**：资格由 dispatcher 实际越过 in-process judge 分支后进入 external launcher 的边机械产生，不用角色白名单。reviewer/canary 在 local-docker 获不同 attempt host 0600 普通文件 mount，在 fleet-worker 获 server 签发的 `{run_id,attempt_id,mode:"read-only",nonce,expires_at}` workspace/result capability；receipt attestation 覆盖 capability digest。拒绝 caller path、surface/mode/run/attempt 不符、stale capability、未验签 receipt、symlink/hardlink/path escape/reuse/missing；owner 正确、nlink=1，终态清理。`/workspace` 只读/最小；judge 不含 `BRAIN_RESULT_FILE`；canary 仍为 `CANARY_OK`、空 artifacts/checks、null error。  
**验证命令**：`: "${TEST_DATABASE_URL:?}"; npx vitest run packages/brain/src/__tests__/harness-kernel-feedback-lineage.real.test.js -t '[B1] external result channel isolation' --reporter=verbose`  
**预期观察**：local-docker 与 fleet-worker receipt 各通过；上述每个反例均 fail closed，两个 attempt inode/path/capability 不同，cleanup 后均不存在。

### Behavior 2：有界 HarnessResult v1 review
**来源**：`[FROM_PRD]` — Golden Path 2。  
**行为/阈值**：只扩展 v1；所有枚举、数量、字符串、整数、262144-byte 边界逐项验证；server-owned binding 必须相等；canonical-v1 digest 由 server 重算，tamper 必拒绝。  
**验证命令**：`: "${TEST_DATABASE_URL:?}"; npx vitest run packages/brain/src/__tests__/harness-kernel-feedback-lineage.real.test.js -t '[B2] bounded HarnessResult v1 review' --reporter=verbose`  
**预期观察**：边界值成功；每个 +1、重复 id、非整数、max_score≠10、非法 enum、binding/digest 篡改具名失败。

### Behavior 3：真实 callback 原子持久化
**来源**：`[FROM_PRD]` — Golden Path 3。  
**行为/阈值**：测试以生产 task/run/attempt store 建行，启动真实 Express socket，以生产 headers/body 发 HTTP。单事务将完整有界 decision 写 `harness_attempts.result`，仅 `{attempt_id,run_id,task_id,round,contract_sha,digest,outcome}` 有界摘要写 `orchestrator_decision_log`；同 digest replay dedupe，异 digest 409，任一写失败全回滚；并发 attempt/run 不串线。响应、日志、两表均不得含 secret/transcript/chain-of-thought/stack/message。  
**验证命令**：`: "${TEST_DATABASE_URL:?}"; npx vitest run packages/brain/src/__tests__/harness-kernel-feedback-lineage.real.test.js -t '[B3] real callback transaction' --reporter=verbose`  
**预期观察**：真实 HTTP success/dedupe/conflict/7 个冻结 error pair 精确匹配；失败后两表本轮时间窗 count=0。

### Behavior 4：精确 prior_review 血缘
**来源**：`[FROM_PRD]` — Golden Path 4。  
**行为/阈值**：ground truth 只取同 run 的精确 reviewer attempt，其 TaskBundle `contract_round=currentRound-1` 且 `contract_sha=上一冻结合同 tip`。Round2 proposer 必带该 `prior_review`；其 persisted `decision.resolutions` 对 feedback id 恰好一对一；Round2 reviewer 获相同 prior_review、resolutions、fresh session。首轮与 server 标识的 legacy adapter 无历史；非首轮缺历史、stale SHA、unknown/duplicate/missing id 在 launch 前阻断。恢复、并发 run 隔离。  
**验证命令**：`: "${TEST_DATABASE_URL:?}"; npx vitest run packages/brain/src/__tests__/harness-kernel-feedback-lineage.real.test.js -t '[B4] exact prior_review lineage' --reporter=verbose`  
**预期观察**：真实 route→DB→ground-truth→dispatcher 跑出 REVISION→APPROVED；所有负例无新 external launch/attempt 副作用。

### Behavior 5：四方 final SHA merge gate
**来源**：`[FROM_PRD]` — Golden Path 5 与 CURRENT MAIN BINDING。  
**行为/阈值**：generator 先 reconcile/rebase 到执行时 `origin/main`，形成 final SHA；ground truth 从真实 evaluator attempt、in-process judge attempt、human approval log 与 server GitHub resolver 取 SHA。四者同 final SHA 才放行；新 head 同时使三份 approval stale。负例 merge/deploy=0；唯一合法例 merge/deploy=1；仅 `gh merge` 与 deploy 可 spy。  
**验证命令**：`: "${TEST_DATABASE_URL:?}"; : "${TEST_PR_URL:?}"; npx vitest run packages/brain/src/__tests__/harness-kernel-feedback-lineage.real.test.js -t '[B5] final SHA merge gate' --reporter=verbose`  
**预期观察**：真实 GitHub GET 解析当前 head；stale/缺任一绑定均 0/0，合法路径 1/1，并停在用户 approval 之前直到真实批准记录存在。

## 接缝清单与禁 mock 边清单

- dispatcher ↔ local detached launcher ↔ runner result file：真文件、真 mount 元数据、真 cleanup；禁 mock 被改边。
- dispatcher ↔ remote transport ↔ fleet-worker/attempt-runner receipt：真 HTTP adapter、真 capability/attestation；禁 mock worker/capability validation。
- callback route ↔ attempt-store/PostgreSQL ↔ decision-log：真 socket、真 PG、真事务；禁 mock pool/store。
- ground-truth ↔ dispatcher 与 evaluator/judge/human records ↔ mergeGate：真 PG/真实链组装；最终 merge/deploy 外部副作用才可 spy。

## 精确文件与 Test Contract

- 实现：`packages/brain/src/orchestrator/{dispatcher.js,execution-contract.js,remote-bridge-transport.js,machine-attestation.js,attempt-store.js,ground-truth.js,gates.js,kernel-handlers.js}`、`packages/brain/src/routes/harness-callback.js`、`packages/brain/scripts/fleet-worker/{fleet-worker.cjs,attempt-runner.cjs}`、`docker/cecelia-runner/entrypoint.sh`、`packages/brain/DEFINITION.md`。
- 唯一新业务测试：`packages/brain/src/__tests__/harness-kernel-feedback-lineage.real.test.js`；合同 Red：`sprints/07272312-kernel-52572b65/tests/harness-kernel-feedback-lineage.contract.test.ts`。
- 禁改：workspace_spec 现有字段/校验、生产 DB、共享 CI、HarnessResult 版本/新 ledger。

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 五行为 | `packages/brain/src/__tests__/harness-kernel-feedback-lineage.real.test.js` | `[B1] external result channel isolation`；`[B2] bounded HarnessResult v1 review`；`[B3] real callback transaction`；`[B4] exact prior_review lineage`；`[B5] final SHA merge gate` | 五个同名业务 assertion fail；依赖/import/config/DB 失败不得计 Red |

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR | 恰好五行为。 |
| NFR | v1；≤262144 bytes；全链 fail closed、隔离、脱敏。 |
| Invariant | server-owned scope/lineage；attempt/result/tenant 不串；四方 SHA 同值。 |
| 判定点 | 无模糊现实判定，N/A；均为字节、DB、inode、receipt、SHA 确定性比较。 |
| 保质期 | capability 到 attempt 终态/expiry 失效；任一新 head 使三份 approval 失效。 |
| 死亡告警 | 冻结错误与具名测试非零退出；persistence_failed 立即告警。 |
| 失败语义 | 校验/血缘/持久化/merge 全拦截；同 digest 幂等，异 digest 冲突。 |
| 效果确认 | 回读两表、receipt/文件属性、TaskBundle、四方 SHA 与 merge/deploy 计数。 |

判定点登记：`N/A`。输入对抗面：callback body、fleet launch body 均不可信；严格 schema/size、server binding、auth/attestation、未知字段拒绝。未覆盖真实链路：仅最终真实 merge/deploy 用 spy，避免测试产生不可逆副作用；GitHub 当前 head 必须真 key 真 GET。其余无 mock 豁免。

## 已知约束与五风险表

- `[回归] dispatcher.test.js`：Fleet 替换 caller path、reviewer fresh/read-only、canary skill-free；`execution-contract.test.js`：Fleet workspace_spec 与 mode 必须匹配；`attempt-runner.test.cjs`：worker-owned mount/cleanup；`harness-attempt-callback.test.js`：receipt/callback 幂等；`ground-truth.test.js`：SHA 锚定；`gates.test.js`：stale verdict 拒绝。
- `[累积FR]` 暂无；58 条铁律逐条映射见 `contract-dod.md`。

| 风险 | 触发 | 必须观察 | 反事实证明 | 处置 |
|---|---|---|---|---|
| R1 通道越权 | judge 获 channel 或 attempt 串用 | 拒绝且无残留 | static-role/cross-attempt 反例令 B1 失败 | external-launch 边派生 + scoped capability |
| R2 客户端伪造血缘 | 改 round/SHA/digest | 严格 409、DB 不变 | tamper 令 B2/B3 失败 | server binding + canonical digest |
| R3 历史串线 | stale/跨 run review | 派发前阻断 | 放宽任一键令 B4 失败 | 精确 reviewer attempt |
| R4 假 Red/假绿 | import/DB 错或 mock modified edge | infra 单列不算 Red | mock pool 版本拒收 | 真 HTTP + 隔离 PG |
| R5 漂移误合并 | 验收后 head 变 | merge/deploy 0/0 | 任一 stale receipt 令 B5 失败 | 四方同 SHA |

## E2E 验收

**journey_type**: autonomous　**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${TEST_DATABASE_URL:?必须显式提供隔离 PostgreSQL}"
: "${TEST_PR_URL:?必须提供可读的测试 PR 供 server 真解析 current head}"
npm ci
node -e 'const u=new URL(process.env.TEST_DATABASE_URL);if(!/^postgres(ql)?:$/.test(u.protocol)||!u.hostname||!u.pathname.slice(1))process.exit(2)'
DB_FACTS=$(psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT current_database()||'|'||COALESCE(inet_server_addr()::text,'local');")
case "$DB_FACTS" in *cecelia*|*prod*) echo "FAIL: production-like DB $DB_FACTS"; exit 1;; esac
echo "$DB_FACTS" | grep -Eq '^(test|harness)[^|]*\|.+' || { echo "FAIL: isolated DB not proven"; exit 1; }
git fetch origin main
MAIN_SHA=$(git rev-parse --verify "origin/main^{commit}")
git merge-base --is-ancestor d37a5e57827900be2651fe39655690238513128f "$MAIN_SHA"
LOG=$(mktemp)
TEST_DATABASE_URL="$TEST_DATABASE_URL" TEST_PR_URL="$TEST_PR_URL" \
  npx vitest run packages/brain/src/__tests__/harness-kernel-feedback-lineage.real.test.js --reporter=verbose | tee "$LOG"
for n in \
  "[B1] external result channel isolation" \
  "[B2] bounded HarnessResult v1 review" \
  "[B3] real callback transaction" \
  "[B4] exact prior_review lineage" \
  "[B5] final SHA merge gate"; do
  grep -F "$n" "$LOG" >/dev/null || { echo "FAIL: missing business result $n"; exit 1; }
done
echo "OK: five real execution-path behaviors passed on $MAIN_SHA"
```
