# Sprint Contract Draft (Round 2)

## Notes
- contract-gate: active (packages/brain/src/lib/contract-gate.js present)
- context-manifest: unavailable
- judgment-pending-user: N/A

## Response Schema（推导来源: N/A）

N/A - 本 sprint 不新增公共 HTTP 成功响应 schema；交付物聚焦 Kernel 内部 required-context 合同、`gh pr view` 当前 head SHA 锚定，以及 `/api/brain/preview/start` 失败证据保留。`/api/brain/preview/start` 成功体继续沿用 `{ port, db_name, status }`，失败时新增保留 `http_status`、`response_body`、`error` 证据。

## 已知约束（来自回归测试）

- [packages/brain/src/__tests__/harness-skill-relay.test.js] -> 显式 `payload.review_required` 永远赢(true/false 都尊重)
- [packages/brain/src/routes/__tests__/tasks-completed-gate.test.js] -> `review_required=true + review_status=pending` 必须 422 拒绝，不得静默放行
- [packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js] -> `spawn:generator-fix` 只应在真实失败条件下出现，callback/decision log 需保持单调一致
- [packages/brain/src/__tests__/shepherd-no-checks.test.js] -> `statusCheckRollup=[]` 不能误判 pass，空检查必须待定或阻断
- [packages/brain/src/__tests__/shepherd-ci-passed.test.js] -> `gh pr view ... statusCheckRollup` 是当前 GitHub checks 采集真入口
- [packages/brain/src/routes/preview.js] -> `/api/brain/preview/start` 成功响应保留 `{ port, db_name, status: "starting" }`
- [累积FR] context-manifest: unavailable

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | Kernel 必须基于服务端可信 `target_environment` 与当前 `head_sha` 生成 required contexts；`local_api` 对 preview 记 neutral/skipped；preview 目标与 post-merge staging/production 对 required 失败保持 fail-closed；preview 启动失败保留 `http_status`/`response_body`/`error`。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 单次 gate 判定内返回结论；不因 curl exit 22 丢失证据；错误 repo/run/旧 SHA 必须立即拒绝；第一条 P0 controller 变更维持 `review_required=true` 且同一最终 SHA 才能过审。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量（安全/数据一致性/幂等） | 不信任客户端 `required_contexts`；不接受 stale SHA；不弱化 staging/production gate；不忽略 required failure；review gate 只认同一最终 SHA。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | PR checks 只对当前 `head_sha` 有效；head 前进后旧 gate verdict 立刻过期；preview 失败证据至少保留到 run 终态与人工复核结束。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | contract tests、Kernel PG integration tests、post-merge hard gate 回归测试在 CI 内直接失败；任务状态与 decision log 记录可审计。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | pre-merge 仅 `local_api` 可把非 required preview 记 neutral；preview target/staging/production 遇 required failure、缺失、旧 SHA、错 repo/run 一律拦截；同一 SHA 上 generator-fix 只因 required failure 触发。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | `gh pr view --json state,mergeStateStatus,headRefOid,statusCheckRollup` 返回当前 head 与 checks；preview 失败记录必须含 `http_status` + `response_body` + `error`；`review_required=true` 的完成态必须等 evaluator/judge/human 均锚定同一最终 SHA。 |

### 判定点登记表（对模糊现实的判断假设 - decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| `target_environment` 是否可信 | A. 读客户端 body 的 required contexts; B. 只读服务端任务 payload | B. 只读服务端任务 payload | PRD 明确禁止信任客户端 required contexts | 错把 preview 设为 required 或非 required，导致误放行/误阻断 |
| ⚠️ 当前 checks 是否属于本次 gate | A. 只看 check 名称; B. 同时校验 `head_sha`、repo、run_id | B. 同时校验 `head_sha`、repo、run_id | PRD 明确要求 stale SHA rejection 与 wrong repo/run isolation | 旧检查放行新提交，直接面客错误 |
| ⚠️ preview failure 是否需要硬阻断 | A. 所有 target 一律 fail; B. 仅 preview-required target fail，`local_api` 记 neutral | B. 仅 preview-required target fail，`local_api` 记 neutral | PRD Golden Path 第 2-3 步 | `local_api` 进入永久 generator-fix 循环，或 preview 目标被误放行 |
| preview 启动失败证据是否完整 | A. 只记 `exit 22`; B. 同时记录 `http_status`、`response_body`、`error` | B. status/body/error 三元组 | PRD 边界情况明确要求保留全部失败证据 | 外部基础设施故障不可审计，修复方向失真 |
| ⚠️ post-merge staging/production 是否允许 neutral | A. 复用 pre-merge neutral; B. 永远 fail-closed | B. 永远 fail-closed | PRD 第 4 步与范围限定 | staging/production gate 被削弱，未验代码进入后续环境 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `statusCheckRollup` 返回旧 SHA | 直接阻断并标 `stale_check_sha` | 是，同一最新 SHA 可重新取 checks | 无降级 |
| checks 来自错 repo 或错 run | 直接阻断并返回 `repo_mismatch` / `run_mismatch` | 是 | 无降级 |
| preview 启动 HTTP 失败或 curl exit 22 | preview target/staging/production 直接阻断；`local_api` 仅在 preview 非 required 时记 neutral 并保留证据 | 是 | 不丢证据，不做静默兜底 |
| required context 缺失 | 直接阻断并标 `missing_required_context` | 是 | 无降级 |
| legacy rollout 传旧字段 | 兼容读取但不覆盖服务端 target-aware contract | 是 | 服务端 required contract 仍为唯一权威 |
| `review_required` 未满足 | 保持 Draft/待审，不 merge 不 deploy | 否，需 evaluator/judge/human 对同一最终 SHA 完成 | 无降级 |

### 输入对抗面（对外暴露 agent 必填 - decisions 27b57469 第9要素）

N/A - 本 sprint 不新增外部 agent 输入面；客户端上传 `required_contexts` 被视为不可信输入并显式忽略。

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
- 合同要求: Kernel 只信任服务端 `tasks.payload.target_environment`；客户端传 `required_contexts`、`preview_required`、`ci_contract` 不得覆盖服务端判定。

### GitHub PR 状态采集
- 真实调用方式: `gh pr view <pr_url> --json state,mergeStateStatus,headRefOid,statusCheckRollup`
- 关键字段:
  - `headRefOid`: 当前 PR head SHA
  - `statusCheckRollup[]`: 每个 check 的 `name/context` 与 `state/conclusion/status`
- 合同要求: gate verdict 必须锚定当前 `headRefOid`；错 repo、错 run、旧 SHA 一律拒绝。

## 接缝清单

- GitHub PR checks 接缝: 真目标为 `gh pr view` 返回的当前 `headRefOid + statusCheckRollup`；final E2E 必须真调一次 `gh pr view`。
- Kernel 判定与 Postgres 接缝: 真目标为 `tasks`、`initiative_runs`、`orchestrator_decision_log`、`harness_attempts` 真库状态；contract tests 必须用真实 Postgres 隔离库。
- preview 启动失败证据接缝: 真目标为 `/api/brain/preview/start` 失败返回；final E2E 必须断言 `http_status`、`response_body`、`error` 三元组至少存在其一组有效证据。

## 禁 mock 边清单

- `required-context-contract.js` ↔ `tasks` / `initiative_runs` / `orchestrator_decision_log` / `harness_attempts`（本单改 gate 判定与状态流转，测试必须真 Postgres）
- `required-context-contract.js` ↔ `ground-truth.js` / `derive.js`（本单改 Kernel 决策接缝，测试必须真调相邻模块）
- `routes/preview.js` ↔ preview 启动失败证据归档（本单改 `/preview/start` 失败证据，不得只 mock 最终结果对象绕过 route/adapter 接缝）

## 未覆盖真实链路清单

- GitHub live checks 在 contract tests 中通过 `fetchStatusCheckRollup` 注入固定输出复现 stale SHA、repo/run mismatch、missing context。真验证补位计划: final E2E 真调一次 `gh pr view "$PR_URL" --json state,mergeStateStatus,headRefOid,statusCheckRollup`。
- preview 外部基础设施失败在 contract tests 中通过 `capturePreviewFailureEvidence` 稳定复现 `curl exit 22 + HTTP 503`。真验证补位计划: final E2E 对本地 Brain `/api/brain/preview/start` 触发失败并断言失败体。

## Golden Path
覆盖父路 Kernel CI/Preview Required Context Contract Recovery 第 1-4 步

[任务入库] → [读取服务端 target/head] → [按 target 生成 required contexts] → [按当前 SHA/repo/run 判定继续或阻断] → [保留 preview 失败证据并维持 post-merge hard gate]

### Step 1: Kernel 只读取服务端任务记录里的 `target_environment` 与当前 head SHA
**来源**: `[FROM_PRD]` - Golden Path 第 1 步直接定义

**可观测行为**: gate 结果里的 `target_environment` 与 `head_sha` 来自服务端任务与当前 PR head；客户端伪造 required contexts 不生效。

**验证命令**:
```bash
NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "服务端 target_environment 覆盖客户端 required_contexts"
```

**硬阈值**: `target_environment=local_api`；`client_required_contexts_used=false`；`head_sha` 为 40 位字符串。

---

### Step 2: `local_api` 对 preview 记 neutral，但 preview 目标必须 fail-closed
**来源**: `[FROM_PRD]` - Golden Path 第 2-3 步直接定义

**可观测行为**: `local_api` 在 preview 全局红时仍可继续，只要真实 required contexts 全过；preview 目标遇 preview fail 时必须阻断并触发 fix/block。

**验证命令**:
```bash
NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "local_api preview neutral 且仅 required contexts 全过才继续"
NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "preview 目标 preview failure 时必须硬阻断"
NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "generator fix 仅在真正 required failure 才触发"
```

**硬阈值**: `local_api` 时 preview `classification in ["neutral","skipped"]`；preview 目标时 `decision=block` 且 `reason=preview_failed`；仅 preview target 可 `generator_fix_required=true`。

---

### Step 3: stale SHA、错 repo、错 run、缺失 required context 全部阻断
**来源**: `[FROM_PRD]` - 边界情况直接定义

**可观测行为**: 旧 SHA、错 repo、错 run、缺失 required context 时一律阻断，并返回审计原因。

**验证命令**:
```bash
NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "stale check SHA 必须拒绝当前 gate"
NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "wrong repo isolation 必须阻断"
NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "wrong run isolation 必须阻断"
NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "缺失 required context 必须阻断并返回审计原因"
```

**硬阈值**: `reason` 分别命中 `stale_check_sha`、`repo_mismatch`、`run_mismatch`、`missing_required_context`；任何一项都不得 neutral 化。

---

### Step 4: preview 失败必须保留证据，legacy rollout 不能覆盖服务端合同，post-merge hard gate 不弱化
**来源**: `[FROM_PRD]` - Golden Path 第 3-4 步直接定义

**可观测行为**: preview 启动失败时保留 `http_status`、`response_body`、`error`；legacy rollout 只兼容读取；staging/production required failure 或 review 未过时继续阻断。

**验证命令**:
```bash
NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "preview 启动失败保留 status body error evidence"
NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "legacy rollout 不得覆盖服务端 required context contract"
NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "post merge staging production hard gate 与 review_required 单 SHA 审批"
```

**硬阈值**: 失败证据对象同时含 `http_status`、`response_body`、`error`；`legacy_inputs_observed=true` 且 `client_required_contexts_used=false`；post-merge 任一 required failure 或 review 未满足时 `merge_allowed=false`。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| target-aware required-context contract | `sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts` | `服务端 target_environment 覆盖客户端 required_contexts` | 导入 `packages/brain/src/orchestrator/required-context-contract.js` 失败，或未按服务端 `target_environment` 生成 required contexts |
| target-aware required-context contract | `sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts` | `local_api preview neutral 且仅 required contexts 全过才继续` | 现有 Kernel 仍把 preview 全局红映射成 `ci=fail`，断言 `decision=continue` 失败 |
| target-aware required-context contract | `sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts` | `preview 目标 preview failure 时必须硬阻断` | 现有实现缺 target-aware contract，preview 失败未 block |
| target-aware required-context contract | `sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts` | `stale check SHA 必须拒绝当前 gate` | 旧 SHA 仍被接受，断言 `reason=stale_check_sha` 失败 |
| target-aware required-context contract | `sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts` | `wrong repo isolation 必须阻断` | 错 repo 仍被接受，断言 `reason=repo_mismatch` 失败 |
| target-aware required-context contract | `sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts` | `wrong run isolation 必须阻断` | 错 run 仍被接受，断言 `reason=run_mismatch` 失败 |
| target-aware required-context contract | `sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts` | `缺失 required context 必须阻断并返回审计原因` | 空 checks 仍被当作 pass/pending 放行 |
| target-aware required-context contract | `sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts` | `preview 启动失败保留 status body error evidence` | `/preview/start` 失败仅留 `exit 22`/message，缺 `http_status` 或 `response_body` |
| target-aware required-context contract | `sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts` | `legacy rollout 不得覆盖服务端 required context contract` | legacy 字段覆盖了服务端 target-aware 判定 |
| target-aware required-context contract | `sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts` | `generator fix 仅在真正 required failure 才触发` | `local_api + preview fail` 仍误触发 generator-fix |
| target-aware required-context contract | `sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts` | `post merge staging production hard gate 与 review_required 单 SHA 审批` | staging/prod 被 neutral 化，或 `review_required` 未锁定同一最终 SHA |

## E2E 验收（最终 final-e2e 跑 - target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

export BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
export DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
export PR_URL="${PR_URL:-https://github.com/perfectuser21/cecelia/pull/4226}"
export SPRINT_DIR="sprints/07272219-kernel-e6ba6d09"

# 1. 真调 GitHub 当前 head SHA 与 checks。
GH_JSON=$(gh pr view "$PR_URL" --json state,mergeStateStatus,headRefOid,statusCheckRollup)
echo "$GH_JSON" | jq -e '.headRefOid | type == "string" and (length == 40)'
echo "$GH_JSON" | jq -e '.statusCheckRollup | type == "array"'

# 2. 运行 target-aware contract tests（真 PG 隔离库）。
NODE_ENV=test npx vitest run "$SPRINT_DIR/tests/kernel-target-aware-required-context.pg.contract.test.ts"

# 3. 尝试触发一次 preview start，保留失败证据；若接口成功也必须保持原成功 schema。
RESP=$(curl -sS -w '\n%{http_code}' -X POST "$BRAIN_URL/api/brain/preview/start" \
  -H 'Content-Type: application/json' \
  -d '{"pr_number":999999,"branch_name":"missing-preview-branch"}')
BODY=$(printf '%s' "$RESP" | sed '$d')
CODE=$(printf '%s' "$RESP" | tail -n1)
if [ "$CODE" -ge 400 ] 2>/dev/null; then
  echo "$BODY" | jq -e '.error | type == "string"'
else
  echo "$BODY" | jq -e 'keys == ["db_name","port","status"]'
fi

# 4. review_required pending 仍不可完成。
NODE_ENV=test npx vitest run packages/brain/src/routes/__tests__/tasks-completed-gate.test.js -t "review_required=true + review_status=pending"

echo "OK: kernel target-aware required-context contract"
```
