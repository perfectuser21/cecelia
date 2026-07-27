# Sprint Contract Draft (Round 1)

## Notes
- contract-gate: active (packages/brain/src/lib/contract-gate.js present)
- context-manifest: unavailable
- judgment-pending-user: N/A

## Response Schema（推导来源: N/A）

N/A - 任务无新增公共 HTTP 响应；本 sprint 聚焦 Kernel 内部 required-context 判定合同、GitHub 检查采集与 `/api/brain/preview/start` 失败证据保留。现有 `/api/brain/preview/start` 成功响应继续沿用 `{ port, db_name, status }`，新增证据字段落在 Kernel gate 判定结果与 preview 失败记录中，由下文 Golden Path 与 DoD 约束。

## 已知约束（来自回归测试）

- [packages/brain/src/__tests__/harness-skill-relay.test.js] -> 显式 `payload.review_required` 永远赢(true/false 都尊重)
- [packages/brain/src/routes/__tests__/tasks-completed-gate.test.js] -> `review_required=true + review_status=pending` 必须 422 拒绝，不得静默放行
- [packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js] -> `spawn:generator-fix` 只应在真实失败条件下出现，且 callback/decision log 需保持单调一致
- [packages/brain/src/__tests__/shepherd-no-checks.test.js] -> `statusCheckRollup=[]` 不能误判 pass，空检查必须待定或阻断
- [packages/brain/src/__tests__/shepherd-ci-passed.test.js] -> `gh pr view ... statusCheckRollup` 是当前 GitHub checks 采集真入口
- [packages/brain/src/routes/preview.js] -> `/api/brain/preview/start` 现有成功体为 `{ port, db_name, status: "starting" }`
- [累积FR] context-manifest: unavailable

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | Kernel 必须基于服务端可信 `target_environment` 与当前 PR head SHA 计算 required contexts；`local_api` 把 preview 记为 neutral/skipped；preview 目标与 post-merge staging/production 对 required 失败保持 fail-closed；preview 启动失败必须保留 HTTP 状态、响应体与错误证据。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 单次 gate 判定在一次 GitHub 状态采集内完成；不得因 curl exit 22 丢失证据；旧 SHA/错 repo/错 run 结果必须被拒；第一条 P0 controller 变更强制 `review_required=true`。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量（安全/数据一致性/幂等） | 不信任客户端上传 required contexts；不接受过期 SHA；不弱化 staging/production gate；review_required 首次 P0 变更保持 Draft，直到 evaluator/judge/human 对同一最终 SHA 通过。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设（详见"判定点登记表"） | 见下方登记表 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | PR checks 仅对当前 `head_sha` 有效；head 前进后旧 gate verdict 立即过期；preview 失败证据与 required-context verdict 至少保留到当前 run 终态与人工复核完成。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | Kernel 集成测试与回归契约测试在 CI 内直接失败；post-merge staging/prod gate 失败通过现有 staging/promote 护栏与任务状态阻断可见。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | pre-merge `local_api` 仅对非 required preview 允许 neutral；preview 目标、staging、production 任一 required 失败/缺失/过期一律拦截；同一 SHA 上 generator-fix 只因 required failure 触发。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | GitHub `gh pr view --json headRefOid,statusCheckRollup` 返回当前 head 与 checks；preview 启动失败需有 `http_status` + `response_body` + `error` 证据；任务完成前需要 `review_required=true` 对同一最终 SHA 的 evaluator/judge/human 全部通过。 |

### 判定点登记表（对模糊现实的判断假设 - decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| `target_environment` 是否可信 | A. 客户端 body 传 required contexts; B. 只读服务端 tasks.payload.target_environment | B. 只读服务端任务记录 | PRD 明确禁止信任客户端 required contexts | 错把 preview 设为 required 或非 required，导致错误放行/阻断 |
| ⚠️ 当前检查结果是否属于本次 gate | A. 仅看 check name; B. 同时校验 `head_sha`、repo、run_id | B. 同时校验 `head_sha`、repo、run_id | PRD 明确要求 stale SHA rejection 与 wrong repo/run isolation | 旧检查放行新提交，直接面客错误 |
| ⚠️ preview 失败是否足以阻断 | A. 所有 target 一律 fail; B. 仅 target-required 时 fail，`local_api` 记 neutral | B. 按 target-aware required contexts 判定 | PRD Golden Path 第 2-3 步 | `local_api` 进入永久 generator-fix 循环，或 preview 目标被误放行 |
| preview 启动失败证据是否完整 | A. 只记录 curl exit code; B. 同时记录 HTTP status、body、stderr/error | B. status + body + error 全保留 | PRD 明确要求保留 body/status/error evidence | 外部基础设施故障不可审计，修复方向失真 |
| ⚠️ post-merge staging/production 能否沿用 neutral 逻辑 | A. 复用 pre-merge target-neutral; B. staging/prod 永远 fail-closed | B. staging/prod 永远 fail-closed | PRD 第 4 步与范围限定 | 生产 gate 被削弱，未验代码进入 staging/production |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| GitHub `statusCheckRollup` 返回旧 SHA | 拦截并标 `stale_check_sha`，不得放行 | 是，同一 head 可重拉当前检查 | 无降级，必须等当前 SHA 检查 |
| checks 来自错 repo 或错 run | 拦截并返回可审计原因 | 是 | 无降级，必须重新采集正确来源 |
| preview 启动 HTTP 失败或 curl exit 22 | preview target/staging/prod 直接阻断；`local_api` 若 preview 非 required 则记 neutral 并保留证据 | 是，同一 run 可重试 preview 启动 | 不丢证据，不用静默 exit 22 兜底 |
| required context 缺失 | 拦截并标 `missing_required_context` | 是 | 无降级 |
| legacy rollout 传入旧字段 | 读取兼容字段但不覆盖服务端 required contract | 是 | 仅兼容读取，服务端结果为准 |
| review_required 未满足 | 任务保持 Draft/待审，不 merge 不 deploy | 否，需 evaluator/judge/human completion on same SHA | 无降级 |

### 输入对抗面（对外暴露 agent 必填 - decisions 27b57469 第9要素）

N/A - 本 sprint 不新增对外暴露 agent 输入面；客户端上传的 required contexts 被视为不可信输入并明确忽略。

## 真实调用方请求 shape

### POST /api/brain/tasks
- 真实认证方式: 本地 Brain 开发环境无额外认证 header
- 真实 payload 关键字段:
```json
{
  "title": "P0 Preview CI Contract + Kernel Target-Aware Gate Recovery 07272218",
  "task_type": "harness_initiative",
  "payload": {
    "target_environment": "local_api",
    "review_required": true,
    "sprint_dir": "sprints/07272219-kernel-e6ba6d09"
  }
}
```
- 合同要求: Kernel 必须只信任服务端 `tasks.payload.target_environment`；客户端传 `required_contexts`、`ci_contract`、`preview_required` 等字段一律不得覆盖服务端判定。

### GitHub PR 状态采集
- 真实调用方式: `gh pr view <pr_url> --json state,mergeStateStatus,headRefOid,statusCheckRollup`
- 关键字段:
  - `headRefOid`: 当前 PR head SHA
  - `statusCheckRollup[]`: check `name/context` 与 `state/conclusion/status`
- 合同要求: 所有 gate verdict 必须锚定到当前 `headRefOid`；错 repo、错 run、旧 SHA 一律拒绝。

## 接缝清单

- GitHub PR checks 接缝: 真目标为 `gh pr view` 返回的当前 `headRefOid + statusCheckRollup`; final E2E 必须做一次真实 gh 查询并断言非空 SHA。
- Kernel 判定与 Postgres 接缝: 真目标为 `tasks` / `initiative_runs` / `orchestrator_decision_log` / `harness_attempts` 真库状态；合同测试必须用真实 Postgres 隔离库，不 mock DB。
- preview 启动失败证据接缝: 真目标为 `/api/brain/preview/start` 触发的启动失败返回；final E2E 必须断言 status/body/error evidence 三元组被保留。

## 禁 mock 边清单

- `required-context-contract.js` ↔ `tasks`/`initiative_runs`/`orchestrator_decision_log`/`harness_attempts`（本单改 gate 判定与状态流转，测试必须真 Postgres）
- `required-context-contract.js` ↔ `ground-truth.js` / `derive.js`（本单改 Kernel 决策接缝，测试必须真调相邻模块）
- `routes/preview.js` ↔ preview 启动失败证据归档（本单改 `/preview/start` 失败证据，不得只 mock 最终结果对象绕过 route/adapter 接缝）

## 未覆盖真实链路清单

- GitHub live checks 在单元/PG 契约测试中通过 `execCmd` 注入固定 `gh pr view` 输出驱动，原因: 需要可重复覆盖 stale SHA、wrong repo/run、missing context 等分支。真验证补位计划: final E2E 在本机已登录 `gh` 环境下执行一次 `gh pr view "$PR_URL" --json headRefOid,statusCheckRollup`。
- preview 外部基础设施失败在契约测试中通过可控失败适配器/假脚本返回 `http_status`、`response_body`、`error`，原因: 需要稳定复现 curl exit 22 与 HTTP 503。真验证补位计划: final E2E 对本地 Brain `/api/brain/preview/start` 执行一次失败证据断言。

## Golden Path
覆盖父路 Kernel CI/Preview Required Context Contract Recovery 第 1-5 步

[任务入库] -> [服务端读取可信 target/head] -> [按 target 生成 required contexts] -> [按当前 SHA/repo/run 判定 continue or block] -> [保留 preview 失败证据并维持 post-merge hard gate]

### Step 1: Kernel 从服务端任务记录读取可信 `target_environment` 与当前 head SHA
**来源**: `[FROM_PRD]` - Golden Path 第 1 步直接定义

**可观测行为**: `local_api` 任务的 gate 判定结果显示 `target_environment=local_api`，并附带当前 `head_sha`；客户端伪造的 required contexts 不影响结果。

**验证命令**:
```bash
NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "服务端 target_environment 覆盖客户端 required_contexts"
```

**硬阈值**: gate 结果中的 `target_environment` 必须等于服务端任务记录；`client_required_contexts_used=false`；`head_sha` 为 40 位字符串。

---

### Step 2: `local_api` 对非 required preview 记 neutral/skipped，只看真正 required contexts
**来源**: `[FROM_PRD]` - Golden Path 第 2 步直接定义

**可观测行为**: 当 preview 全局红但 `target_environment=local_api` 时，结果将 preview 标为 `neutral` 或 `skipped`，且仅当 `local_api` 所需 contexts 全部在当前 SHA 上通过才继续。

**验证命令**:
```bash
NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "local_api preview neutral 且仅 required contexts 全过才继续"
```

**硬阈值**: `decision=continue`; preview context `classification in ["neutral","skipped"]`; 任一 `local_api` required 失败时不得继续。

---

### Step 3: preview-required 目标对 preview 失败、缺失、过期 SHA、错 repo/run 全部 fail-closed
**来源**: `[FROM_PRD]` - Golden Path 第 3 步直接定义

**可观测行为**: preview 目标遇到 preview fail、missing context、stale SHA、wrong repo/run 时一律阻断，并返回可审计原因。

**验证命令**:
```bash
NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "preview 目标 preview failure 缺失 stale SHA 错 repo run 一律阻断"
```

**硬阈值**: `decision=block`; `reason` 属于 `preview_failed|missing_required_context|stale_check_sha|repo_mismatch|run_mismatch`; 不得写成 neutral。

---

### Step 4: preview 启动失败保留 `http_status`、`response_body` 与 `error` 证据
**来源**: `[FROM_PRD]` - Golden Path 第 3 步与边界情况直接定义

**可观测行为**: `/preview/start` 启动失败时，gate 结果或失败记录中同时包含 HTTP 状态码、响应 body、curl/network error；不再只有 `exit 22`。

**验证命令**:
```bash
NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "preview 启动失败保留 status body error evidence"
```

**硬阈值**: 失败证据对象必须包含 `http_status`、`response_body`、`error` 三个字段且非空；`error` 需保留原始失败文本。

---

### Step 5: post-merge staging/production 继续 fail-closed，首个 P0 controller 变更强制 review gate
**来源**: `[FROM_PRD]` - Golden Path 第 4 步 + task description 直接定义

**可观测行为**: post-merge staging/production 任一 required context 失败或缺失时继续阻断；第一条 P0 controller 变更令 `review_required=true`，PR 维持 Draft，直到 evaluator/judge/human 对同一最终 SHA 全部通过。

**验证命令**:
```bash
NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "post merge staging production hard gate 与 review_required 单 SHA 审批"
```

**硬阈值**: staging/production `decision=block` when any required fails or missing; `review_required=true`; `merge_allowed=false` until all approvals reference the same final SHA.

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| target-aware required-context contract + preview evidence + review gate | `sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts` | `服务端 target_environment 覆盖客户端 required_contexts` | 导入 `packages/brain/src/orchestrator/required-context-contract.js` 失败，或导出的 `createRequiredContextContract`/`evaluateTaskGate` 未实现 |
| target-aware required-context contract + preview evidence + review gate | `sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts` | `local_api preview neutral 且仅 required contexts 全过才继续` | 现有 Kernel 仍把 preview fail 映射成 `ci=fail`，断言 `decision=continue` 失败 |
| target-aware required-context contract + preview evidence + review gate | `sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts` | `preview 目标 preview failure 缺失 stale SHA 错 repo run 一律阻断` | 现有实现缺 target-aware contract 或 stale/repo/run 校验，断言 `decision=block` 失败 |
| target-aware required-context contract + preview evidence + review gate | `sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts` | `preview 启动失败保留 status body error evidence` | 现有 `/preview/start` 失败仅留 `exit 22`/`error.message`，缺 `http_status` 或 `response_body` 断言失败 |
| target-aware required-context contract + preview evidence + review gate | `sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts` | `legacy rollout 不得覆盖服务端 required context contract` | 旧 rollout 字段仍可覆盖服务端 target-aware 判定，断言失败 |
| target-aware required-context contract + preview evidence + review gate | `sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts` | `generator fix 仅在真正 required failure 才触发` | 现有实现 preview 全局红会误触发 generator-fix，断言无 `spawn:generator-fix` 失败 |
| target-aware required-context contract + preview evidence + review gate | `sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts` | `post merge staging production hard gate 与 review_required 单 SHA 审批` | staging/prod 仍被 neutral 化或 review_required 未固定 true，断言失败 |

## E2E 验收（最终 final-e2e 跑 - target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

export BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
export DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
export PR_URL="${PR_URL:-https://github.com/perfectuser21/cecelia/pull/4226}"

# 1. Real GitHub caller shape: current head SHA + statusCheckRollup must be queryable.
GH_JSON=$(gh pr view "$PR_URL" --json state,mergeStateStatus,headRefOid,statusCheckRollup)
echo "$GH_JSON" | jq -e '.headRefOid | type == "string" and (length == 40)'
echo "$GH_JSON" | jq -e '.statusCheckRollup | type == "array"'

# 2. Contract tests: target-aware required-context gate on real PostgreSQL isolation DB.
NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts

# 3. Preview failure evidence must preserve status/body/error when preview is required.
RESP=$(curl -sS -X POST "$BRAIN_URL/api/brain/preview/start" \
  -H 'Content-Type: application/json' \
  -d '{"pr_number":999999,"branch_name":"missing-preview-branch"}' || true)
if [ -n "$RESP" ]; then
  echo "$RESP" | jq -e '(.error | type == "string") or (.status == "starting")'
fi

# 4. Post-merge hard gates stay fail-closed and review_required remains true on first P0 change.
NODE_ENV=test npx vitest run packages/brain/src/routes/__tests__/tasks-completed-gate.test.js -t "review_required=true + review_status=pending"

echo "OK: kernel target-aware required-context contract"
```
