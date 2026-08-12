# Sprint Contract Draft (Round 3)

## Response Schema（推导来源: PRD 字面 + api_registry）

### Endpoint: POST /api/brain/tasks

**Success (HTTP 201)**：保留既有任务创建响应，并至少返回 `id`、`task_type`、`routing_receipt_id`；coding mutation 的 `task_type` 必须字面等于 `harness_initiative`。

### Endpoint: GET /api/brain/work-routing/receipts/:id/validate

**认证与真实调用 shape**：调用方必须发送 `Authorization: Bearer ${CECELIA_INTERNAL_TOKEN}`（与 `packages/brain/src/middleware/internal-auth.js` 一致），并逐字段发送 query `task_id`、`run_id`、`repo`、`branch`、`base_sha`。token 缺失或错误必须在 receipt 查询前返回 HTTP 401；不得接受 body token、payload receipt 投影或匿名 localhost 旁路。

**Success (HTTP 200)**：顶层 keys 必须完全等于 `['base_sha','branch','repo','routing_receipt_id','run_id','task_id','valid']`，其中 `valid=true`，六个上下文字段逐字等于请求与专用 receipt/active run 的交叉校验结果。

**Error (HTTP 4xx/503)**：顶层 keys 必须完全等于 `['error','reason_code','valid']`，`valid=false`、`error` 为非空 string；稳定 `reason_code` 至少包括 `auth_required`、`auth_invalid`、`receipt_not_found`、`receipt_expired`、`receipt_superseded`、`task_mismatch`、`run_mismatch`、`repo_mismatch`、`branch_mismatch`、`base_sha_mismatch`、`brain_unavailable`。认证错误为 401，not found 为 404，过期/被取代/上下文不匹配为 409，依赖不可用为 503；任何错误不得返回 HTTP 200 或 `valid:true`。

**禁用字段名**：`skill` 作为 `task_type`、payload 内伪造 receipt 作为事实源、第五种 `change_kind`。

## 技术与证据来源

- PRD 主体：bundle `thin_prd`、`prep_prd_body` 与冻结 `sprint-prd.md`。
- API/DB/test registry：本轮分别读取 50/50/30 条；字段命名沿用 snake_case、测试沿用 Vitest `describe/it/expect`。
- Unified Map：task payload 给出 `map_scope=cecelia`，但 `map_repo` 缐失，标记 `[MAP_NOT_CONFIGURED: map_repo]`；不得回退到领域硬编码。`must_run_assertions=[]`（未能在缺 repo 时计算 radius）。
- Map freshness/fact revision：运行时必须从 fresh Universal Map 查询结果取得，不能固化起草 attempt 的 snapshot。
- gp-anchor: skipped (product-map.json not found)

## 已知约束（来自回归测试与累积 FR）

- `[累积FR]` 本 line 暂无已验收 ability；PRD 铁律逐项进入 DoD Invariant。
- `packages/brain/src/orchestrator/**/__tests__`：状态机、Impact Contract、frozen baseline 与 dispatcher 行为必须保持真实相邻模块接线。
- `docker/cecelia-runner/__tests__`：runner shell 合同必须在容器真实路径验证。
- `packages/engine/tests/integration`：hook 使用真实临时 Git worktree，写动作 fail closed、只读动作不误伤。
- context-manifest 内容已由冻结 PRD 的“铁律清单/累积 FR”段提供；不得用旧运行身份替代 Runner 注入身份。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 所有有头/无头 coding mutation 经唯一 Work Router、不可变 receipt、Kernel Harness 2.0、fresh Map 与 Impact Contract。 |
| NFR（做得多好） | 新 coding receipt 覆盖率 100%，无 receipt 新业务任务 0，coding `dev` 直接派发 0，路由同输入同版本确定。 |
| Invariant（永不违反） | 不默认 repo；不反推 `change_kind`；不新增 `legacy_exempt`；Provider 无 push/callback/lease 权限；历史 receipt 不改写。 |
| 判定点（怎么知道） | 见下表。 |
| 保质期（何时过期） | Map freshness 查询时计算；validation result 短时有效；map recovery contract 绑定单 attempt 且到期不可复用。 |
| 死亡告警（停了谁知道） | 记录 `work_route_blocked`、`route_violation`、`map_preflight_failed`，Dashboard 展示并由现有告警链路消费。 |
| 失败语义（挂了怎么办） | 动作前 fail closed；有头 exit 2；无头拒绝 executor；保留审计后可新增 receipt/resume。 |
| 效果确认（已发≠已生效） | scratch 真实 DB 查询 receipt、run、Map revision、active Impact Contract 与 violation 事件；容器实测凭据不可见和 push 失败。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ coding mutation 判定 | 显式字段 / 来源合同 / task type / 语义 / 安全默认 | 按该固定优先级，coding unknown 当 write | PRD §9 | 漏路由导致未受控仓库写入 |
| ⚠️ repo 唯一性 | cwd 默认 / repo hint 与 Map facts | 只接受唯一规范 repo key | PRD §7.3 | 跨 repo 污染 |
| Map 可用性 | HTTP 成功 / metadata freshness+revision+scanner | 校验全部字段并绑定 baseline | PRD §10 | stale facts 放行错误 diff |

notes: judgment-pending-user 不适用；以上判定点已在批准设计中拍板。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| repo 未知/歧义 | 路由阻塞并写 reason_code | 同 source/source_id/router_version 幂等 | 无默认 repo |
| Map missing/stale/invalid | Provider attempt 创建前失败 | refresh 后 resume | 仅稳定原因码可进入窄化 map_recovery |
| receipt 无效或 Brain 不可达 | 有头 exit 2；无头拒绝派发 | 读取验证可重试 | 不改 payload 自救 |
| Generator 越权 | pushurl 熔断/降权/剥离凭据，run 失败 | 新 attempt | 仅 trusted transport 发布 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| API/Conversation/Thalamus/Discovery/Scheduler/Child | 未信任至受限 | 结构化枚举校验，语义只作 evidence | unknown coding 按 write；未知枚举、降档和反向推导拒绝 |

## 真实调用方请求 shape

- 有头 hook：从 `.dev-lock.<branch>` 读取 `task_id/routing_receipt_id/run_id/repo/branch/base_sha`，以 `Authorization: Bearer ${CECELIA_INTERNAL_TOKEN}` 调用 `GET /api/brain/work-routing/receipts/:id/validate`，六个 lock 字段按上述 query shape 逐字段发送；不得从当前 tool 反推 change kind。
- 无头 Dispatcher：以 task id 和 receipt id 查询专用表，核对 canonical type/pipeline/repo/run；payload 投影不是事实源。
- Generator：执行身份只从 Runner 注入的 `HARNESS_ATTEMPT_ID`、`HARNESS_PROVIDER`、`HARNESS_ACCOUNT`、`HARNESS_MACHINE`、`HARNESS_MODEL`、`HARNESS_RUNNER_DIGEST`、`CAPABILITY_SNAPSHOT_ID` 读取；本合同不固化 Proposer identity。

## 禁 mock 边清单

- Work Router ↔ `createRoutedTask()` ↔ PostgreSQL `tasks/work_routing_receipts`：必须真 PostgreSQL 验证同事务、幂等及 append-only。
- Task creation entrypoints ↔ Work Router：入口合同不得 mock Work Router，逐项验证冻结 inventory。
- Kernel preflight ↔ Universal Map ↔ Impact Contract store：必须用真实临时 repo 与真实测试 DB，禁 mock 被改的数据接力。
- dev-mode tool hook ↔ receipt validation API ↔ Git worktree：必须真实 shell/worktree，网络故障 fail closed。
- Dispatcher ↔ executor guard、runner entrypoint ↔ Provider process：必须验证 executor 未被调用、容器路径/UID/env/pushurl 的真实边界。
- worktree lifecycle ↔ active Kernel run：origin 归一化、日志脱敏与活跃 cwd 保护必须走真实 Git remote/worktree，不得用字符串替身代替删除判定边。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A；第三方 API 不在本 Sprint Golden Path。）

## 接缝清单

1. Git remote/worktree 生命周期：真实临时 bare remote 使用含凭据 URL，重复运行两次，日志不得出现 userinfo，active Kernel cwd 不得被删除。[接缝×2]
2. PostgreSQL 原子 receipt/Map/Impact Contract：attempt-scoped scratch DB 中查询本轮 5 分钟时间窗记录。[接缝×2]
3. runner 容器 trust boundary：真实容器命令链验证 pushurl 熔断、非特权 UID/capability 与 callback/lease env 缺失。[接缝×2]

## Golden Path

覆盖父路 `e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29` 第 1-10 步。

[任意入口 coding mutation] → [恢复前置安全回归] → [原子路由 receipt] → [四档 Kernel profile] → [fresh Map + Impact Contract] → [有头/无头动作闸] → [隔离 Generator] → [Evaluator/Judge/CI/merge fence] → [scratch 真实验收]

### Step 1: 修复工作区恢复前置缺陷
**来源**: `[FROM_PRD]` — Golden Path 具体步骤 1 与 Recovery Addendum。

**可观测行为**: credential-bearing origin 与等价无凭据 origin 匹配；所有日志脱敏；活跃 detached Kernel cwd 保留，真正孤儿可清理。

**验证命令**: `npx vitest run sprints/08121555-unified-work-router/tests/recovery-workspace-contract.test.ts packages/brain/src/harness-worktree.integration.test.js`

**硬阈值**: 两次接缝执行均通过，日志中凭据命中数 0，active cwd 删除数 0。

### Step 2: 原子路由并正向选择四形式
**来源**: `[FROM_PRD]` — 设计 §7-9、Knife 0-2。

**可观测行为**: coding mutation 原子得到 append-only receipt 与 `harness_initiative`；四个 change kind 只正向映射，unknown coding 按 write，repo 歧义阻塞。

**验证命令**: `DB_URL="$DB_URL" npx vitest run sprints/08121555-unified-work-router/tests/knife01-routing-contract.test.ts packages/brain/src/__tests__/integration/work-routing-store.integration.test.js packages/brain/src/__tests__/work-router-entrypoints.test.js`

**硬阈值**: 四档 4/4 命中；task/receipt 同生同灭；70 类型与入口 inventory 从 SSOT 动态核验，无重复或漏项。

### Step 3: Map 与 Impact Contract 强制 preflight
**来源**: `[FROM_PRD]` — 设计 §10/§10.1、Knife 3。

**可观测行为**: 计划或生成前绑定同 repo fresh Map/baseline revision 与 active Impact Contract；异常不创建 Provider；map_recovery 仅单次窄化恢复。

**验证命令**: `DB_URL="$DB_URL" npx vitest run sprints/08121555-unified-work-router/tests/knife3-map-contract.test.ts packages/brain/src/orchestrator/preflight/map-impact-contract.integration.test.js`

**硬阈值**: fresh=放行；missing/stale/revision/scanner/repo mismatch=全部拒绝；所有新 coding run policy=`required`，新增 legacy_exempt=0。

### Step 4: 动作期闸门与 Generator 隔离
**来源**: `[FROM_PRD]` — 设计 §12、Knife 4。

**可观测行为**: 有头/无头共享 receipt 合同；写动作前校验完整上下文；Generator frozen baseline、pushurl、setpriv、env 剥离均实际生效。

**验证命令**: `bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh && npx vitest run sprints/08121555-unified-work-router/tests/knife4-guards-contract.test.ts packages/brain/src/routes/__tests__/work-routing-validation.integration.test.js packages/brain/src/orchestrator/__tests__/dispatcher-routing-receipt.test.js && bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh`

**硬阈值**: validation API 匿名/错 token 均 HTTP 401 且分别返回 `auth_required`/`auth_invalid`；有效 Bearer 请求 HTTP 200、响应 keys 完整且六字段逐字匹配；superseded receipt HTTP 409 且 `reason_code=receipt_superseded`；其余无效情形写动作 exit 2 或拒绝 executor；只读 exit 0；Provider push 必败且敏感 env 可见数 0。

### Step 5: scratch 多入口真实验收
**来源**: `[FROM_PRD]` — 设计 §16.6、Knife 5。

**可观测行为**: API/Intent/Capture 三个 coding 请求全走 Harness/Map/Impact；content/research/review 不误路由；stale 阻断后 refresh/resume 保留审计。

**验证命令**: `DB_URL="$DB_URL" bash packages/brain/scripts/smoke/unified-work-router-smoke.sh && DB_URL="$DB_URL" npx vitest run sprints/08121555-unified-work-router/tests/knife5-acceptance-contract.test.ts packages/brain/src/__tests__/work-routing-observability.test.js`

**硬阈值**: coding 3/3 receipt+Harness+正确 Map+active Impact；对照 3/3 正确 pipeline；direct coding dev=0；命令 exit 0。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
: "${HARNESS_ATTEMPT_ID:?Runner must inject current execution identity}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner must inject current capability snapshot}"
export DATABASE_URL="$DB_URL"
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# 仓库真实 migration 在同一空库完成；不得注入业务 cookie/tenant。
cd packages/brain
npm run migrate
psql "$DB_URL" -tAc "SELECT to_regclass('work_routing_receipts') IS NOT NULL" | grep -qx t
cd ../..

# required CI/DevGate 与真实 scratch smoke。
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
bash packages/brain/scripts/smoke/unified-work-router-smoke.sh

# 本轮数据库副作用必须在时间窗内，且三入口全部建立 receipt、run、正确 repo Map 与 active Impact Contract。
psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) >= 3 FROM work_routing_receipts WHERE created_at > NOW() - interval '5 minutes' AND work_kind='coding_mutation' AND canonical_task_type='harness_initiative'" | grep -qx t
psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc "SELECT count(DISTINCT r.task_id)=3 FROM work_routing_receipts r JOIN initiative_runs ir ON ir.task_id=r.task_id JOIN harness_impact_contracts ic ON ic.task_id=r.task_id AND ic.status='active' JOIN map_scope_repositories msr ON msr.scope_key=r.map_scope->>0 AND msr.repo=r.repo WHERE r.created_at > NOW()-interval '5 minutes' AND r.source IN ('api','thalamus','capture') AND ir.impact_contract_policy='required'" | grep -qx t
# 对照 pipeline 与 review 派生修复路径逐项验证，不用汇总数量代替。
psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc "SELECT bool_and((source='content-smoke' AND pipeline='content') OR (source='research-smoke' AND pipeline='research') OR (source='review-smoke' AND pipeline='code_review') OR (source='review-fix-smoke' AND pipeline='harness')) FROM work_routing_receipts WHERE created_at > NOW()-interval '5 minutes' AND source IN ('content-smoke','research-smoke','review-smoke','review-fix-smoke')" | grep -qx t
# stale 阻断必须发生在 Provider 前，refresh/resume 后成功且原失败审计仍存在。
psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc "SELECT EXISTS(SELECT 1 FROM work_routing_acceptance_events WHERE scenario='stale_resume' AND preflight_reason_code='map_stale' AND provider_attempts_before_refresh=0 AND resumed_after_refresh AND failure_audit_preserved AND created_at > NOW()-interval '5 minutes')" | grep -qx t
# runner 容器实弹 receipt：敏感凭据不可见、Provider push 必败、Judge 后 trusted transport 真发布。
psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc "SELECT EXISTS(SELECT 1 FROM work_routing_acceptance_events WHERE scenario='generator_trust_boundary' AND callback_token_visible=false AND lease_credentials_visible=false AND provider_push_succeeded=false AND non_privileged_uid=true AND capabilities_empty=true AND trusted_transport_published=true AND created_at > NOW()-interval '5 minutes')" | grep -qx t
psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) = 0 FROM tasks WHERE created_at > NOW() - interval '5 minutes' AND task_type='dev' AND payload->>'mutation_intent'='write'" | grep -qx t

# 当前 validation identity 只取 Runner late-bound 注入；证据留存摘要，不输出 secrets。
jq -n --arg attempt "$HARNESS_ATTEMPT_ID" --arg snapshot "$CAPABILITY_SNAPSHOT_ID" --arg started "$STARTED_AT" '{attempt_id:$attempt,capability_snapshot_id:$snapshot,started_at:$started,status:"passed"}' > /tmp/unified-work-router-evidence.json
jq -e '.status=="passed" and (.attempt_id|length>0) and (.capability_snapshot_id|length>0)' /tmp/unified-work-router-evidence.json
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 15 分钟 / 15 动作（路由与权限边界高风险）。
高风险面:
- 错输入: 未知 `change_kind`、空 repo、歧义 repo、伪造 payload receipt。
- 重复提交: 相同 source/source_id/router_version 并发创建两次。
- 中途中断: task 插入后 receipt 插入失败、Map refresh 与 resume 之间进程退出。
- 边界值: credential URL 含 percent encoding、超长 repo path、detached HEAD、superseded receipt 链。
发现分级: P0/P1 阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 恢复前置 | `tests/recovery-workspace-contract.test.ts` | 真实 Git origin 含凭据时仍归一化、日志脱敏并保护活跃 Kernel cwd | 缺 canonicalize/redact/protect 导出 |
| Knife 0-2 | `tests/knife01-routing-contract.test.ts` | 四档正向映射且禁止 gear/stage/task type 反推 change_kind；冻结入口逐项覆盖并永久锁定三个既有陷阱 | Work Router/inventory 尚不存在 |
| Knife 3 | `tests/knife3-map-contract.test.ts` | fresh 同 repo Map 才放行且 map_recovery 只能单次窄化消费 | preflight/recovery 尚不存在 |
| Knife 4 | `tests/knife4-guards-contract.test.ts` | receipt 无效时动作前 fail closed，Generator 无 push/callback/lease 能力 | guard/trust boundary 尚不存在 |
| Knife 5 | `tests/knife5-acceptance-contract.test.ts` | smoke receipt 明确证明三 coding、三对照、stale/resume 与审计 | scratch acceptance receipt 尚不存在 |

## Contract Notes

- contract-gate: applicable (`packages/brain/src/lib/contract-gate.js` exists).
- 本轮 map_repo 缺失是明确启动阻塞：Generator 只能在 Routing Receipt 将 repo 唯一解析为当前 frozen repo 后继续；不得默认 Cecelia。
