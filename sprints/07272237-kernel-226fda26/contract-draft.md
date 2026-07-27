# Sprint Contract Draft (Round 2)

contract-gate: active
覆盖父路 Kernel required-context gate 第 1-5 步

## Notes

- context-manifest: unavailable
- registry freshness: localhost:5221 registry 不可达，Response Schema 以 PRD 字面和现有源码对齐为准
- initiative_id: unavailable in proposer inputs；`task-plan.json` 用 `pending` 占位
- red-evidence: 合同测试的红灯必须来自 required-context / exact-SHA / preview-evidence / post-merge gate 行为缺失，不接受 vitest 配置错误、依赖缺失、生产库写入或 approval 真写入伪装失败
- contract scope: 只覆盖 server-owned required-context 推导、preview evidence seam、ground-truth→derive/gate→decision-log 闭环、post-merge gate、Draft PR approval invalidation、legacy rollout 显式开关
- contract-gate: active

## Response Schema（推导来源: [PRD字面/api_registry推导]）

### Endpoint: `POST /api/brain/preview/start`
**Success (HTTP 200)**:
```json
{"port":5300,"db_name":"cecelia_preview_42","status":"starting"}
```
- `port` (number, 必填): 来源——现有 preview route 兼容响应
- `db_name` (string, 必填): 来源——现有 preview route 兼容响应
- `status` (string, 必填): 来源——PRD 第 4 步“保持兼容响应”，固定为 `starting`
**禁用字段名**: `ok`, `success`, `reason_only`, `preview_result`
**Error (HTTP 4xx/5xx)**:
```json
{"error":"<string>"}
```

### Endpoint: `GET /api/brain/harness/kernel/release-gate/:run_id`
**Success (HTTP 200)**:
```json
{
  "allow": false,
  "reason": "preview_required_failed",
  "pr_head_sha": "<sha>",
  "target_environment": "local_api",
  "required_contexts": [
    {
      "name": "preview-deploy / preview_deploy",
      "status": "neutral",
      "tested_sha": "<sha>"
    }
  ]
}
```
- `allow` (boolean, 必填): 来源——PRD Golden Path 出口 gate 判定
- `reason` (string, 必填): 来源——PRD 第 2/3/5 步“稳定阻断原因”
- `pr_head_sha` (string, 必填): 来源——PRD 第 1/2/5 步 exact current SHA 绑定
- `target_environment` (string, 必填): 来源——PRD 第 1/3 步 server-owned 推导
- `required_contexts` (array, 必填): 来源——PRD 第 1/2/3 步
**禁用字段名**: `expected_repo`, `expected_run`, `expected_role`, `caller_target_environment`, `approved_sha`
**Error (HTTP 4xx/5xx)**:
```json
{"error":"<string>"}
```

## 已知约束（来自回归测试）

- [packages/brain/src/orchestrator/__tests__/ground-truth.test.js] → `reviewRequired 从 tasks.payload.review_required 读取，reviewApproved 必须锚定当前 head_sha`
- [packages/brain/src/orchestrator/__tests__/ground-truth.test.js] → `same-SHA evidence approval cannot satisfy the later merge gate after evaluator and judge PASS`
- [packages/brain/src/orchestrator/__tests__/gates.test.js] → `evaluate/judge PASS 但 sha 不匹配时必须拒绝`
- [packages/brain/src/routes/__tests__/preview.test.js] → `POST /start` 当前仅透传 `port/db_name/status`，失败响应仍是简单 `{error}``
- [packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js] → `approval 必须带 current head sha + review_request_hop，旧 sha 批准不可复用`
- [tests/regression/release-gate-rtm/release-gate-contract.test.mjs] → 发布 gate 类脚本采用独立 blocker、不可默认放行的 contract 风格
- [累积FR] context-manifest: unavailable

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 只依据服务端 task/run/PR 真相推导 target_environment、base_repo、run/task 身份、required contexts 与 current head SHA；所有 gate 与 approval 都绑定 exact current SHA。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 每个 blocker 独立返回稳定 reason；preview 失败证据三字段非空；post-merge gate 不可合并短路；legacy rollout 显式开关但不放松新语义。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | caller 参数不能创建 authority；未知 mapping fail-closed；Draft PR + `autoMergeRequest=null`；不写真实 approval；不碰 production DB。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | 与 SHA 绑定的 verdict/approval 在 PR head 变化后立即过期；legacy rollout 开关仅在迁移窗口有效，后续可移除。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | kernel gate 合同测试、preview route 回归、post-merge gate 回归、decision-log 闭环测试在 CI 内发现；失败路径必须保留稳定 reason 与 evidence。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | preview/staging/production/final-report 任一缺失或失败均 fail-closed；未知 required-context mapping fail-closed；approval 旧 sha 失效且需重新批准。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 通过 ground-truth→derive/gate→decision-log 的真实记录、release-gate API 返回、preview failure evidence 持久化字段确认；拿不到即 blocker。 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️required context 是否属于当前 target_environment | A. 调用方传参；B. 服务端 task/run/PR/PR head + mapping 推导 | B. 服务端真相推导 | PRD 第 1/3 步明示 caller 不得建立 authority | 错把无关 check 当已满足，导致未验收代码继续推进 |
| ⚠️preview 对 local_api 是否可记 neutral | A. 只看 preview 记录缺失；B. 仅当当前 SHA 上全部本地 required context 通过且无 preview 依赖时允许 neutral | B. 仅当全部本地 required context 通过 | PRD 第 3 步明示 local required failure 必须阻断 | 失败本地上下文被 preview neutral 掩盖，假绿放行 |
| ⚠️human approval 是否仍有效 | A. 只看存在 APPROVED；B. APPROVED 必须与当前 final SHA、Draft PR、同一 review_request_hop 对齐 | B. 同一 final SHA + 同一 review_request_hop | PRD 第 5 步与现有 ground-truth stale approval 约束 | 新提交后复用旧批准，直接面客错误 |
| preview failure 是否算已留痕 | A. HTTP 非 200 即算；B. evidence 持久化 `http_status/response_body/error` 三字段全部非空 | B. 三字段全部非空 | PRD 第 4 步明示 failure evidence 三字段必须完整 | 无法追责真实失败原因，重复假修复 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| stale check SHA / wrong repo / wrong run/task | 返回独立 blocker reason，`allow=false` | 是 | 不降级，不复用 caller 参数 |
| preview-required target 缺 preview 或 preview FAIL | 硬失败 `preview_required_missing|preview_required_failed` | 是 | 无降级 |
| local_api 当前 SHA 上 local required context 失败 | 硬失败 `local_required_context_failed` | 是 | 不允许 preview neutral 掩盖 |
| missing/unknown required-context mapping | 硬失败 `required_context_mapping_missing` | 是 | 无降级，必须补 server-owned mapping |
| external infrastructure failure | 保留稳定 `external_infrastructure_failure` + failure evidence | 是 | 不允许 success status 或空响应伪装 |
| 新提交后旧 approval | 旧 approval 作废，重新请求人审 | 是 | 无降级 |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

N/A — 本 sprint 为 Brain 内部 gate / preview route / approval 逻辑修复，不新增对外 agent 输入面。

## 真实调用方请求 shape

### GitHub Actions Preview Workflow → `POST /api/brain/preview/start`
- 调用方: `.github/workflows/preview-deploy.yml`
- 认证: `Authorization: Bearer ${DEPLOY_TOKEN}`
- Header: `Content-Type: application/json`
- Body:
```json
{"pr_number":42,"branch_name":"feature-branch"}
```
- 契约要求: 保持成功响应 `{port,db_name,status}` 兼容；失败证据写入服务端持久化层，不允许靠 caller 传 `expected_repo/expected_run/role` 建 authority

### Release Gate Reader → `GET /api/brain/harness/kernel/release-gate/:run_id`
- 调用方: Brain/Kernel 自身 gate 检查
- 认证: 无新增 caller authority 字段
- 关键查询来源: `initiative_runs.current_task_id`、`tasks.payload`、PR 当前 head SHA、server-owned required-context mapping、accepted checks/tested_sha
- 契约要求: `expected_repo/expected_run/role` 只能记录调试上下文，不能改变 gate 结果

## 接缝清单

- `ground-truth.js` ↔ `initiative_runs/tasks/orchestrator_decision_log + GitHub PR head`：target_environment、base_repo、run/task 身份、current SHA、approval 有效性必须从真实服务端事实推导。
- `derive.js`/`gates.js` ↔ release gate 结果：每个 blocker 必须独立 reason，不能 alternation 合并。
- `.github/workflows/preview-deploy.yml` ↔ `routes/preview.js` ↔ evidence persistence：真实 curl 调 `/api/brain/preview/start` 失败后必须留下 `http_status/response_body/error`。
- post-merge gate ↔ staging/production/final report records：缺任一证据都必须独立 hard block。

## 禁 mock 边清单

- `packages/brain/src/orchestrator/ground-truth.js` ↔ `initiative_runs/tasks/orchestrator_decision_log`（本单改 server-owned 推导，测试必须真读相邻结构化记录）
- `packages/brain/src/orchestrator/derive.js` ↔ `packages/brain/src/orchestrator/gates.js`（本单改 exact-SHA gate 语义，测试必须真走 derive→gate）
- `.github/workflows/preview-deploy.yml` ↔ `packages/brain/src/routes/preview.js`（本单改 preview curl/evidence seam，测试不得 mock `capturePreviewFailureEvidence` 这条边）
- post-merge gate 查询 ↔ staging/production/final report truth source（本单改独立 blocker，测试必须逐项真走 gate 逻辑）

## 未覆盖真实链路清单

- GitHub Actions 真 runner 调用 `/api/brain/preview/start` 的 end-to-end 由 evaluator 在受控环境复跑；GAN 阶段仅冻结 workflow 文本与 route seam，未真调 GitHub 执行器
- 人工 approval 真写入被显式禁止；合同测试只用只读/隔离 fixture 验证 stale approval 失效，不写真实 approval 记录

## Golden Path

[入口：Kernel 收到合同校验任务] → [服务端 task/run/PR 真相推导 target_environment / base_repo / required contexts / current SHA] → [exact current SHA 上逐个检查 required contexts 与 preview/local blockers] → [preview failure route 写入三字段 evidence，成功路径单独保持兼容] → [ground-truth→derive/gate→decision-log 与 post-merge 独立 blocker 一致收口] → [出口：只有同一 final SHA 的 evaluator PASS、judge PASS、human approval 与所有 required contexts 齐全时才 allow]

### Step 1: 服务端 task/run/PR 真相决定 authority 与 required contexts
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步。

**可观测行为**: caller 提供的 `expected_repo`、`expected_run`、`role` 不能改变 target_environment、base_repo、run/task 身份、required-context 集合或 current head SHA。

**验证命令**:
```bash
cd packages/brain
npx vitest run ../../sprints/07272237-kernel-226fda26/tests/required-context-gate.contract.test.ts \
  --config ../../sprints/07272237-kernel-226fda26/tests/vitest.contract.config.mjs \
  -t 'server-owned facts derive target_environment and required contexts' --reporter=verbose
```

**硬阈值**: `kernelReleaseGateTruth` 必须直接给出 `run_id/task_id/base_repo/target_environment/current_head_sha`；任何 caller-owned expected_* 参数只可进入 ignored hints，不得成为 authority。

---

### Step 2: accepted checks 必须锚定 exact current SHA，负例逐项独立
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步。

**可观测行为**: stale SHA、wrong repo、wrong run/task、missing required context、preview-required failure、local required-context failure、missing context mapping、external infrastructure failure 各自独立失败，不能用 alternation/共享 PASS 掩盖。

**验证命令**:
```bash
cd packages/brain
npx vitest run ../../sprints/07272237-kernel-226fda26/tests/required-context-gate.contract.test.ts \
  --config ../../sprints/07272237-kernel-226fda26/tests/vitest.contract.config.mjs \
  -t 'independent blocker reason stays exact' --reporter=verbose
```

**硬阈值**: 八类 blocker 全部独立命名；任一 case 失败不能因为另一个 case 的 success path 通过；每条负例都有独立 `it()` 与稳定 reason。

---

### Step 3: `local_api` 仅在全部本地 required contexts 通过时允许 preview neutral
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步。

**可观测行为**: 无 preview 依赖的 `local_api` 只有在当前 SHA 上每个 local required context 都 PASS 时才可 `preview=neutral|skipped`；只要本地 required context 有失败就阻断；preview-dependent target 缺 preview 或 preview FAIL 必须硬失败。

**验证命令**:
```bash
cd packages/brain
npx vitest run ../../sprints/07272237-kernel-226fda26/tests/required-context-gate.contract.test.ts \
  --config ../../sprints/07272237-kernel-226fda26/tests/vitest.contract.config.mjs \
  -t 'local_api preview neutral only after local contexts pass|preview-dependent targets hard fail without preview' --reporter=verbose
```

**硬阈值**: `local_required_context_failed`、`preview_required_missing`、`preview_required_failed`、`required_context_mapping_missing` 互不混淆。

---

### Step 4: 真实 preview workflow 失败路径必须留下三字段 evidence
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步。

**可观测行为**: `.github/workflows/preview-deploy.yml` 的 curl → `/api/brain/preview/start` 接缝在失败路径写入非空 `http_status`、`response_body`、`error`；成功路径单独验证，不能用 `|| true`、空响应或 success status 伪装失败。

**验证命令**:
```bash
cd packages/brain
npx vitest run ../../sprints/07272237-kernel-226fda26/tests/preview-route-evidence.contract.test.ts \
  --config ../../sprints/07272237-kernel-226fda26/tests/vitest.contract.config.mjs \
  -t 'preview failure persists http status response body and error|preview success path stays separate' --reporter=verbose
```

**硬阈值**: 失败断言三字段均非空且落 `preview_failure_evidence`；成功断言不得命中 failure evidence case；workflow 文本仍包含真实 `curl -sf ... /api/brain/preview/start`，且无 `|| true`。

---

### Step 5: generator-fix 与 post-merge gate 只认可 exact final SHA 的完整闭环
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步。

**可观测行为**: generator-fix 必须通过真实 ground-truth→derive/gate→decision-log 在 exact SHA 上证明；post-merge 的 staging missing、staging SKIP/no-contract、staging FAIL、stale/missing tested_sha、production missing、production FAIL、final report missing 全部独立 hard block；PR 保持 Draft 且 `autoMergeRequest=null`，evaluator PASS、judge PASS、human approval 必须同一 final SHA，新提交会使旧批准失效。

**验证命令**:
```bash
cd packages/brain
npx vitest run ../../sprints/07272237-kernel-226fda26/tests/kernel-release-gate.contract.test.ts \
  --config ../../sprints/07272237-kernel-226fda26/tests/vitest.contract.config.mjs \
  -t 'ground truth derive gate decision-log close the loop on current sha|post-merge gate stays independent|stale approval invalidated by new commit' --reporter=verbose
```

**硬阈值**: post-merge blocker 至少八项逐个独立；`review_required=true` 不得在 evaluator/judge PASS 但 approval 旧 SHA 时放行；generator-fix 的闭环证明必须经真实 `collectGroundTruth -> derive`。

---

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

SPRINT_DIR="sprints/07272237-kernel-226fda26"

# 1. 冻结真实 preview workflow seam
WORKFLOW=".github/workflows/preview-deploy.yml"
[ -f "$WORKFLOW" ] || { echo "FAIL: missing $WORKFLOW"; exit 1; }
grep -F '/api/brain/preview/start' "$WORKFLOW" >/dev/null || { echo "FAIL: workflow 未调 /api/brain/preview/start"; exit 1; }
grep -F 'curl -sf' "$WORKFLOW" >/dev/null || { echo "FAIL: workflow 未使用真实 curl -sf"; exit 1; }

# 2. 逐个运行 Red-first 合同测试；当前缺行为时必须失败在 expect，而非配置错误
set +e
cd packages/brain
npx vitest run "../../$SPRINT_DIR/tests/required-context-gate.contract.test.ts" --config "../../$SPRINT_DIR/tests/vitest.contract.config.mjs" --reporter=verbose
REQ_EXIT=$?
npx vitest run "../../$SPRINT_DIR/tests/preview-route-evidence.contract.test.ts" --config "../../$SPRINT_DIR/tests/vitest.contract.config.mjs" --reporter=verbose
PREVIEW_EXIT=$?
npx vitest run "../../$SPRINT_DIR/tests/kernel-release-gate.contract.test.ts" --config "../../$SPRINT_DIR/tests/vitest.contract.config.mjs" --reporter=verbose
GATE_EXIT=$?
cd ../..
set -e

# 3. 当前 proposer 阶段要求 Red evidence：至少一个合同测试因为目标行为缺失而失败
[ "$REQ_EXIT" -ne 0 ] || [ "$PREVIEW_EXIT" -ne 0 ] || [ "$GATE_EXIT" -ne 0 ] || {
  echo "FAIL: 预期 Red evidence，但三个合同测试都通过"; exit 1;
}

# 4. 红证据必须不是 runner/config 级崩溃
for LOG in "$SPRINT_DIR"/tests/*.ts; do
  [ -f "$LOG" ] || { echo "FAIL: 缺测试文件"; exit 1; }
done

echo "OK: proposer contract 产出了面向 exact-SHA required-context gate 的 Red-first 合同测试"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| server-owned required-context 推导与独立 blocker | `sprints/07272237-kernel-226fda26/tests/required-context-gate.contract.test.ts` | `server-owned facts derive target_environment and required contexts`; `independent blocker reason stays exact`; `local_api preview neutral only after local contexts pass`; `preview-dependent targets hard fail without preview`; `legacy rollout stays explicit and does not weaken target-aware semantics` | 当前缺少 `kernelReleaseGateTruth` 与 exact-SHA target-aware gate 分支时，至少一条 `expect(...).toMatchObject(...)` 失败 |
| preview workflow → route failure evidence seam | `sprints/07272237-kernel-226fda26/tests/preview-route-evidence.contract.test.ts` | `preview workflow uses real curl to POST /api/brain/preview/start without swallowing failure`; `preview failure persists http status response body and error`; `preview success path stays separate` | 当前 preview route 未持久化三字段 evidence 或 workflow/route 接缝未闭合时失败 |
| ground-truth→derive/gate→decision-log 与 post-merge 独立硬闸 | `sprints/07272237-kernel-226fda26/tests/kernel-release-gate.contract.test.ts` | `ground truth derive gate decision-log close the loop on current sha`; `post-merge gate stays independent`; `stale approval invalidated by new commit` | 当前若仍能复用旧 SHA approval、merged 后短路 report、或忽略 post-merge 独立 blocker，则失败 |
