# Sprint Contract Draft (Round 1)

## Notes

- 实现基线唯一 SSOT：`dd0dffac1774d92d8080ff4a4524e0ae8359d530`，来源为 `inputs.implementation_baseline`；`workspace_spec.base_sha` 只选择本角色 checkout，不能改写该权威来源。
- `[MAP_NOT_CONFIGURED]`：payload 有 `map_scope=["F0"]`，但无 `map_repo`；因此 radius 未运行，`must_run_assertions=[]`，不得领域硬编码补造。freshness/fact revision 无可用证据。
- api/db/test registry 均为空，按 PRD 字面合同并标 `[NEW_PATTERN]`。context-manifest: unavailable。
- contract-gate: enabled；gp-anchor: skipped (product-map.json not found)。
- validation identity 仅从 Runner 注入的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID` late-bind；禁止固化本轮 proposer 身份。

## Response Schema（推导来源: PRD字面/NEW_PATTERN）

PRD 未定义统一新响应 envelope。现有 `POST /api/brain/work-routing/validate` 成功响应精确为 `valid:boolean`、`routing_receipt_id:string`、`expires_at:string`；失败响应为 `valid:false`、`reason_code:string`。禁用字段：`ok` 不得替代 `valid`。

## 已知约束

- `packages/brain/src/__tests__/harness-worktree.test.js`：worktree 幂等复用且 clone 后 origin 不留 token。
- `docker/cecelia-runner/__tests__/entrypoint-frozen-baseline-guard.test.sh`：baseline 验 ancestry，拒绝 imported lineage。
- `packages/brain/scripts/fleet-worker/workspace-manager.test.cjs`：frozen_baseline 必须严格布尔传播。
- `[累积FR]` context-manifest: unavailable；`[Map] must_run_assertions=[]`。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR | API/Intent/Capture 等 coding mutation 统一经 Router、Receipt、Map/Impact、Generator、Evaluator、Judge 与 merge fence。 |
| NFR | coding receipt coverage=100%；新 legacy_exempt=0；日志零凭据。 |
| Invariant | receipt append-only；四档只正向映射；基线恒为上述 SHA 且候选必须以后者为祖先。 |
| 判定点 | 见下表。 |
| 保质期 | Map 按现有 freshness；recovery 单 attempt 消费；receipt 永久审计。 |
| 死亡告警 | 稳定 reason_code 与审计事件在下一巡检周期暴露。 |
| 失败语义 | receipt/Map/contract/repo 任一无效均 fail closed，不降级。 |
| 效果确认 | 真 PostgreSQL、真 Git、真 hook/runner 与服务端 Judge 机械闸交叉验证。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ coding mutation | task_type / 结构化 intent+router | 后者，unknown 按 write | PRD 边界 | 绕过 Harness 写仓 |
| Map 可用性 | 记录存在 / freshness+revision+scanner | 后者 | PRD Knife 3 | 错事实驱动生成 |

judgment-pending-user: 无；安全默认值已由冻结 PRD 拍定。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| repo/receipt 无效 | 拒绝创建或执行 | 是 | 无 |
| Map/Impact 无效 | Provider 前失败关闭 | resume 幂等 | 仅批准 recovery |
| Judge 证据不足 | FAIL，不发布 | 补证可重试 | 无 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权拒绝 |
|---|---|---|---|
| API/Intent/Capture | 未信任 | 枚举 normalize；自然语言不授予权限 | unknown write、repo 歧义拒绝 |

## 真实调用方请求 shape

- 有头 hook 从 lock 取 `task_id/routing_receipt_id/run_id/repo/branch/base_sha`，以 JSON body 调现有受认证 validation API。
- 无头 Dispatcher 以 task id + receipt id 查 append-only 表；payload 不是 canonical facts。

## 禁 mock 边清单

- Router ↔ PostgreSQL tasks/work_routing_receipts；Map preflight ↔ Impact Contract ↔ Kernel run store。
- hook ↔ validation API；Dispatcher ↔ executor；runner ↔ Git trust boundary。
- Evaluator evidence ↔ Judge server mechanical gate；不得用模型文本替代服务端 verdict。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

1. `[接缝×2]` 真 PostgreSQL 上 API/Intent/Capture 路由、Map/Impact 与 stale/resume。
2. `[接缝×2]` 真临时 Git 上 credential origin 与 active detached cwd。
3. 真 runner/Judge：执行身份 late-bound，Evaluator 证据由服务端机械闸验收。

## Golden Path

覆盖父路 `3bf6c116-169c-46ec-bc7c-b335a22f80ec` 第 1-6 步

### Step 1: 恢复工作区安全
**来源**: `[FROM_PRD]` — Golden Path 1。
**可观测行为**: credential origin 规范化且脱敏；active detached cwd 不删。
**验证命令**: `cd packages/brain && npx vitest run src/__tests__/harness-worktree-recovery.test.js --reporter=verbose`
**硬阈值**: 三类回归全绿，exit 0。

### Step 2: 原子 Router 与全入口收敛
**来源**: `[FROM_PRD]` — Golden Path 2。
**可观测行为**: coding task+receipt 原子创建，四档正向映射，入口 inventory 零遗漏。
**验证命令**: `cd packages/brain && DB_URL="$DB_URL" npx vitest run src/__tests__/work-router.test.js src/__tests__/task-creation-inventory.test.js src/__tests__/work-router-entrypoints.test.js src/routes/__tests__/capture-atoms-routing.test.js --reporter=verbose`
**硬阈值**: exit 0；coverage=100%。

### Step 3: Map/Impact fail-closed
**来源**: `[FROM_PRD]` — Golden Path 3。
**可观测行为**: fresh 同 repo Map/active contract 才建 Provider；stale/mismatch 拒绝。
**验证命令**: `cd packages/brain && DB_URL="$DB_URL" BASELINE_SHA=dd0dffac1774d92d8080ff4a4524e0ae8359d530 npx vitest run src/orchestrator/preflight/map-impact-contract.test.js src/orchestrator/__tests__/map-recovery-contract.test.js --reporter=verbose`
**硬阈值**: exit 0；policy=required；revision 精确等于基线。

### Step 4: mutation guard 与 Generator 边界
**来源**: `[FROM_PRD]` — Golden Path 4。
**可观测行为**: 有头/无头动作前验 receipt；Generator 无 push/callback 权限。
**验证命令**: `bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh && bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh`
**硬阈值**: 非法 mutation exit 2；边界测试 exit 0。

### Step 5: scratch 多入口真实产出
**来源**: `[FROM_PRD]` — Golden Path 5。
**可观测行为**: 三 coding 入口全路由，对照任务不误路由，stale→refresh→resume 留审计。
**验证命令**: `DB_URL="$DB_URL" BASELINE_SHA=dd0dffac1774d92d8080ff4a4524e0ae8359d530 bash packages/brain/scripts/smoke/unified-work-router-smoke.sh`
**硬阈值**: exit 0；DB 记录限本轮 5 分钟窗口。

### Step 6: Router 到 Judge 服务端机械验收
**来源**: `[FROM_PRD]` — Golden Path 5-6 与任务 description。
**可观测行为**: 候选以冻结基线为祖先；Evaluator 提交结构化证据；Judge 仅在服务端机械闸字面 PASS 后授权发布。
**验证命令**: `DB_URL="$DB_URL" BASELINE_SHA=dd0dffac1774d92d8080ff4a4524e0ae8359d530 node packages/brain/src/orchestrator/unified-router-acceptance.js`
**硬阈值**: exit 0 且 stdout 含 `MECHANICAL_GATE=PASS`、候选 SHA、Evaluator/Judge 各自 runtime provenance。

## E2E 验收（最终 final-e2e 跑）

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet injects attempt DB}"
: "${HARNESS_ATTEMPT_ID:?Runner identity required}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner capability required}"
BASELINE_SHA=dd0dffac1774d92d8080ff4a4524e0ae8359d530
git merge-base --is-ancestor "$BASELINE_SHA" HEAD
node --input-type=module -e 'import pg from "pg"; import {runMigrations} from "./packages/brain/src/migrate.js"; const p=new pg.Pool({connectionString:process.env.DB_URL}); try { await runMigrations(p); } finally { await p.end(); }'
psql "$DB_URL" -tAc "SELECT to_regclass('public.work_routing_receipts') IS NOT NULL" | grep -qx t
DB_URL="$DB_URL" BASELINE_SHA="$BASELINE_SHA" bash packages/brain/scripts/smoke/unified-work-router-smoke.sh
OUT=$(DB_URL="$DB_URL" BASELINE_SHA="$BASELINE_SHA" node packages/brain/src/orchestrator/unified-router-acceptance.js)
printf '%s\n' "$OUT" | grep -q 'MECHANICAL_GATE=PASS'
printf '%s\n' "$OUT" | grep -q "BASELINE_SHA=$BASELINE_SHA"
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 全链机械闸 | `tests/unified-work-router-contract.test.ts` | `Router to Judge service mechanical acceptance is executable` | 基线缺验收模块，Vitest import 失败 |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 20 分钟 / 20 动作
高风险面:
- 错输入: unknown change_kind、歧义 repo、伪造 receipt。
- 重复提交: 相同 source/source_id 并发两次。
- 中途中断: receipt 事务、Map refresh、Evaluator 回调中断。
- 边界值: credential URL 编码、detached HEAD、stale 临界点。
发现分级: P0/P1 阻塞 merge；P2/P3 记录 findings。
