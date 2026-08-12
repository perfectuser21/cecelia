# Sprint Contract Draft (Round 1)

## Notes

- 实现基线（唯一 SSOT）：`310ab9e704d4e3f866e6ce7beb25b79dd0f9d524`。角色 checkout `0d13851e...` 仅用于本轮起草，不得写入实现血统、Routing Receipt、Map 或 Impact Contract。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- gp-anchor: skipped (product-map.json not found)
- Unified Map：scope=`cecelia`，repo=`perfectuser21/cecelia`；查询时 freshness=`fresh`，fact revision=`d4956f25993a2e389d9b06f3e807b15df7f2b268`。任务未声明 expected_files，radius 返回无 `must_run_assertions`，因此没有额外 Map 回归断言；不得用领域硬编码补造。
- 本合同只 late-bind 执行身份：Evaluator/Judge 证据分别读取 Runner 注入的 `HARNESS_ATTEMPT_ID`、`HARNESS_PROVIDER`、`HARNESS_ACCOUNT`、`HARNESS_MACHINE`、`HARNESS_MODEL`、`HARNESS_RUNNER_DIGEST`、`CAPABILITY_SNAPSHOT_ID`；各角色保留各自 provenance，并以 SHA-256 串联证据，禁止共用起草角色身份。

## Response Schema（推导来源: PRD字面）

本任务有内部 API 与持久化合同，但 PRD 未规定单一新 HTTP response envelope；不得擅自增加统一 response key。各入口继续遵守现有 API schema，新增 receipt 查询/验证响应以 `work_routing_receipts` 字段字面投影为准。稳定错误响应必须包含字符串 `reason_code`，包括 `repo_unknown`、`map_stale`、`impact_contract_missing`、`route_violation`。`[NEW_PATTERN]`：`POST /api/brain/work-routing/validate` 的成功响应至少包含 `valid:boolean`、`routing_receipt_id:string`、`expires_at:RFC3339 string`，错误响应至少包含 `valid:false`、`reason_code:string`；禁用字段名：`ok`（不得替代 `valid`）。

## 已知约束（来自回归测试、累积 FR 与 Map）

- `packages/brain/src/__tests__/harness-worktree.test.js` → 已有工作区必须幂等复用；非 git/orphan 才重建；远端 clone 后 origin 不落 token。
- `docker/cecelia-runner/__tests__/entrypoint-frozen-baseline-guard.test.sh` → baseline guard 必须验证 lineage，不能接受 imported/rebased lineage。
- `packages/brain/scripts/fleet-worker/workspace-manager.test.cjs` → frozen_baseline 必须作为严格布尔合同传播。
- `[累积FR]` context-manifest 本轮不可用；保留 PRD 中 active decisions 与 Knife 0-5 为约束来源。
- `[Map]` `must_run_assertions=[]`；freshness/fact revision 仅作起草证据，不得替代 frozen implementation baseline。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 唯一 Work Router 原子创建 task+不可变 receipt；四形式正向映射；所有 coding 写入进入 Kernel Harness 2.0；Map/Impact Contract、动作闸、Generator 隔离、迁移与 scratch 验收闭环。 |
| NFR（做得多好） | 新 coding receipt coverage=100%，新 coding `dev` 直接派发=0，新 `legacy_exempt`=0；同输入+router version 决策确定；关键入口与接缝用真 PostgreSQL/真 Git/真容器验证。 |
| Invariant（永不违反） | baseline 是候选 HEAD 祖先而非完成态 HEAD；receipt append-only；change_kind 只正向决定 profile；Map/Impact Contract 均绑定同一 frozen baseline；无 receipt/Map/contract fail closed。 |
| 判定点（怎么知道） | 见下表。 |
| 保质期（何时过期） | validation result 为短时签名凭证；Map freshness 按现有阈值实时计算；map recovery contract 有 expires_at 且单 attempt 消费；receipt 历史永久保留。 |
| 死亡告警（停了谁知道） | `work_route_blocked`、`route_violation`、`map_preflight_failed` 事件与 WarRoom 指标使值班方在下一 tick/巡检周期发现。 |
| 失败语义（挂了怎么办） | repo/Map/receipt/API 不可用均拦截，不降级，不创建 Provider attempt；修复事实后 resume，历史失败审计保留。 |
| 效果确认（已发≠已生效） | DB 查 task+receipt+run+active contract；真 Git 验 ancestry/diff；真容器验证 token 不可见、push 被熔断；scratch 多入口实际运行确认。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ coding mutation 判定 | 仅 task_type / 结构化 mutation_intent+来源合同+注册表+语义分类 | 后者，unknown coding 按 write | PRD §9 | 漏路由导致仓库被无 Harness 修改 |
| repo 唯一性 | cwd 默认 / 显式 hint+Map repo facts 唯一解析 | 后者 | PRD §7.3 | 跨 repo 污染 |
| Map 可用性 | 只看记录存在 / freshness+revision+scanner version | 后者 | PRD §10 | 过期事实生成错误合同 |
| receipt 有效性 | payload 投影 / 专用 append-only 表+active run/lock/worktree 联合验证 | 后者 | PRD §8.3、§12 | 伪造 payload 绕过动作闸 |

judgment-pending-user: 无；上述高风险 coding mutation 安全默认值已在批准 PRD §9 明确拍定。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| repo 未知/歧义 | `repo_unknown`，不建可执行 task | 是，source+source_id+router_version | 无 |
| receipt/API 不可用 | mutation tool exit 2 或 dispatcher 拒绝并记 `route_violation` | 是 | 只读诊断仍可运行 |
| Map stale/missing/invalid | preflight 失败且不建 Provider attempt | resume 幂等 | 仅稳定故障码触发窄化 map_recovery |
| Impact Contract 缺失/越界 | Structure/Diff Gate 拒绝 | 合同 revision 后重验 | 无 legacy_exempt |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| API/Conversation/Inbox/Thalamus/Discovery/Scheduler/Child | 未信任到受限结构化 | normalize 后只接收枚举；自然语言只作 evidence，不能直接决定执行权限 | 未知 mutation 按 write；未知 enum/repo 拒绝；禁止 payload 伪造 receipt |

## 真实调用方请求 shape

- Brain 创建任务 API、Intent、Capture、Actions、Scheduler 与 child spawn 都只向 `createRoutedTask(client, NormalizedWorkRequest)` 传 PRD §8.1 字段；不得自行 INSERT 最终 task type。
- 有头 hook 从 `.dev-lock.<branch>` 读取 `task_id`、`routing_receipt_id`、`run_id`、`repo`、`branch`、`base_sha`，通过受认证 Brain API 调 `POST /api/brain/work-routing/validate`；认证沿用现有 Brain hook 认证 header，receipt id 不得用 body 中任意 route facts 替代。
- 无头 Dispatcher 使用 claim 后的 task id 与 payload 中仅作引用的 `routing_receipt_id` 查询专用表；canonical facts 以表为准。

## 禁 mock 边清单

- `createRoutedTask` ↔ PostgreSQL `tasks`/`work_routing_receipts`/`map_recovery_contracts`：原子性、append-only、幂等必须真 PostgreSQL。
- 创建入口 ↔ `createRoutedTask`：33 处 inventory 中每个可执行入口不得 mock 统一边界。
- Work Router ↔ Map preflight ↔ Impact Contract ↔ Kernel run store：需真相邻模块和真临时 Git repo。
- `.dev-lock` ↔ Brain validation API ↔ `dev-mode-tool-guard.sh`：需真 hook/临时 worktree；只允许替换外部网络传输。
- Dispatcher ↔ executor guard、runner entrypoint ↔ 容器 Git hook/setpriv/env：需真实命令链与容器路径。
- `ensureHarnessWorktree` ↔ git origin/活跃 Kernel workspace registry：需真临时 Git repo；不得 mock 被改的 Git/活跃状态判断。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A；单元测试可替换无关通知渠道，但上述禁 mock 边必须由 integration/smoke 真验补位。）

## 接缝清单

1. `[接缝×2]` credential-bearing origin 与活跃 detached Kernel cwd：真临时 Git remote 重复两次，确认 canonical match、日志无 credential、活跃目录未删除。
2. `[接缝×2]` task+receipt+Map+Impact Contract DB 链：attempt-scoped 真 PostgreSQL重复两次，所有行带本轮时间窗且无 legacy_exempt。
3. 真容器 Generator trust boundary：一次真实 runner 容器验证 hook path、UID/capabilities、凭据清除和 blocked push；动作具有环境成本且不重复执行，完整 stdout 留证。

## Golden Path

覆盖父路 `factory/F1` 第 1-6 步

入口请求 → immutable Routing Receipt → Harness+fresh Map+Impact Contract → Knife 0-5 实现 → Evaluator/Judge → scratch 多入口真实验收

### Step 0: 恢复前置，工作区安全复用
**来源**: `[FROM_PRD]` — RECOVERY ADDENDUM 与任务 description。
**可观测行为**: 含 credential 的同仓 origin 归一化后不被判 orphan；任何日志不含 credential；active Kernel cwd 即便 detached 也不被删除。
**验证命令**: `cd packages/brain && npx vitest run src/__tests__/harness-worktree-recovery.test.js --reporter=verbose`
**硬阈值**: 3 个回归场景全绿、重复两次一致；命令 exit 0。

### Step 1: Work Router 生成原子不可变凭证
**来源**: `[FROM_PRD]` — PRD §7-9、实施 Task 1。
**可观测行为**: coding mutation 原子得到 `harness_initiative` 与 append-only receipt；四种 change_kind 只正向映射 profile，降档/反推拒绝。
**验证命令**: `cd packages/brain && npx vitest run src/__tests__/work-router.test.js src/__tests__/integration/work-routing-store.integration.test.js --reporter=verbose`
**硬阈值**: 四形式全覆盖；task/receipt 同生同灭；UPDATE/DELETE 拒绝；命令 exit 0。

### Step 2: 全入口收敛且三处旧缺陷永久回归
**来源**: `[FROM_PRD]` — PRD §12、§18 Knife 0-2。
**可观测行为**: 从 `VALID_TASK_TYPES` 动态核对 SSOT，机器清单逐项覆盖全部入口；Planner/Proposal/Capture 三陷阱被永久测试锁定。
**验证命令**: `cd packages/brain && npx vitest run src/__tests__/task-creation-inventory.test.js src/__tests__/work-router-entrypoints.test.js src/routes/__tests__/capture-atoms-routing.test.js --reporter=verbose`
**硬阈值**: inventory 无遗漏、无业务裸 INSERT、三陷阱全绿；不得复制固定类型数量作为第二 SSOT。

### Step 3: Map/Impact Contract 与 frozen baseline 强制启动
**来源**: `[FROM_PRD]` — PRD §10、§18 Knife 3、Recovery Contract Correction。
**可观测行为**: 所有新 coding run 都 required；fresh Map/contract 才进入 Provider；stale/missing/invalid/cross-repo 全 fail closed；合法 map_recovery 仅限 allowlist。
**验证命令**: `BASELINE_SHA=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524 cd packages/brain && npx vitest run src/orchestrator/__tests__/change-kind-profiles.test.js src/orchestrator/preflight/map-impact-contract.test.js src/orchestrator/__tests__/map-recovery-contract.test.js --reporter=verbose`
**硬阈值**: `impact_contract_policy=required`、`legacy_exempt=0`；receipt/Map/contract revision 精确等于 baseline；候选 HEAD 只要求 baseline 为祖先。

### Step 4: 有头/无头动作闸与 Generator trust boundary
**来源**: `[FROM_PRD]` — PRD §12、§15、§18 Knife 4。
**可观测行为**: mutation 动作前验证 lock+receipt；无头 executor 前验证同一 receipt；Generator 无 push/callback 能力且 baseline lineage guard 生效。
**验证命令**: `bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh && cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-routing-receipt.test.js --reporter=verbose && cd ../.. && bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh`
**硬阈值**: 非法路径 exit 2/拒派；合法路径通过；容器内 callback token 不可见、provider push 失败、hook 可达。

### Step 5: scratch 多入口真实验收并保留审计
**来源**: `[FROM_PRD]` — PRD §16.6、§18 Knife 5。
**可观测行为**: API/Intent/Capture 三个 coding 入口均有 receipt、Harness run、正确 Map 与 active contract；content/research/review 不误路由，review 派生修复进入 Harness；stale→拒绝→刷新→resume 保留失败审计。
**验证命令**: `DB_URL="$DB_URL" BASELINE_SHA=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524 bash packages/brain/scripts/smoke/unified-work-router-smoke.sh`
**硬阈值**: coding coverage=100%、coding dev direct=0、新 legacy_exempt=0，DB 副作用均在 5 分钟时间窗内。

### Step 6: baseline lineage 与治理收口
**来源**: `[FROM_PRD]` — Recovery Contract Correction 与 required command evidence。
**可观测行为**: 实现从 frozen baseline 追加永久 RED/GREEN commits；最终 HEAD 不要求等于 baseline，但必须以 baseline 为祖先；Evaluator/Judge 审实际 diff 与真实产出。
**验证命令**: `BASELINE_SHA=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524; git merge-base --is-ancestor "$BASELINE_SHA" HEAD && test "$(git rev-parse HEAD)" != "$BASELINE_SHA" && node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs`
**硬阈值**: ancestry exit 0、HEAD≠baseline、RED commit 先于对应 GREEN commit、三项 DevGate exit 0。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped empty PostgreSQL DB_URL}"
: "${HARNESS_ATTEMPT_ID:?Runner must inject current role identity}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner must inject current capability snapshot}"
BASELINE_SHA=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524
export DB_URL BASELINE_SHA
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EVIDENCE_DIR="${SPRINT_DIR:-sprints/08121555-unified-work-router}/evidence/${HARNESS_ATTEMPT_ID}"
mkdir -p "$EVIDENCE_DIR"
git merge-base --is-ancestor "$BASELINE_SHA" HEAD
test "$(git rev-parse HEAD)" != "$BASELINE_SHA"
cd packages/brain
npx vitest run src/__tests__/harness-worktree-recovery.test.js src/__tests__/work-router.test.js src/__tests__/task-creation-inventory.test.js src/__tests__/work-router-entrypoints.test.js src/routes/__tests__/capture-atoms-routing.test.js src/orchestrator/__tests__/change-kind-profiles.test.js src/orchestrator/preflight/map-impact-contract.test.js src/orchestrator/__tests__/map-recovery-contract.test.js src/orchestrator/__tests__/dispatcher-routing-receipt.test.js --reporter=verbose | tee "$OLDPWD/$EVIDENCE_DIR/vitest.log"
cd ../..
bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh | tee "$EVIDENCE_DIR/headed-guard.log"
bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh | tee "$EVIDENCE_DIR/generator-boundary.log"
DB_URL="$DB_URL" BASELINE_SHA="$BASELINE_SHA" bash packages/brain/scripts/smoke/unified-work-router-smoke.sh | tee "$EVIDENCE_DIR/scratch-smoke.log"
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) > 0 FROM work_routing_receipts WHERE created_at >= '$STARTED_AT'::timestamptz" | grep -qx t
psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) = 0 FROM initiative_runs WHERE created_at >= '$STARTED_AT'::timestamptz AND impact_contract_policy = 'legacy_exempt'" | grep -qx t
printf '%s\n' "attempt=$HARNESS_ATTEMPT_ID snapshot=$CAPABILITY_SNAPSHOT_ID baseline=$BASELINE_SHA head=$(git rev-parse HEAD)" > "$EVIDENCE_DIR/provenance.txt"
sha256sum "$EVIDENCE_DIR"/* > "$EVIDENCE_DIR/sha256sums.txt"
echo "Unified Work Router Golden Path PASS"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Recovery 前置 | `tests/unified-work-router-contract.test.ts` | `credential-bearing origin canonicalization`；`active Kernel workspace protection` | 当前导出/保护合同不存在 |
| Router/基线 | `tests/unified-work-router-contract.test.ts` | `four change kinds map forward only`；`frozen baseline is an ancestor, not final HEAD` | 当前 Work Router 与新 receipt migration 不存在 |
| Map/边界 | `tests/unified-work-router-contract.test.ts` | `coding run requires Map and Impact Contract`；`Generator trust boundary removes privileged channels` | 当前强制 wiring 未完成 |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 20 分钟 / 20 动作（范围跨 DB、Git、hook、容器，风险高于默认）
高风险面:
- 错输入: mutation_intent/change_kind/source 传未知枚举；repo_hint 同时匹配两个 repo。
- 重复提交: 同 source/source_id/router_version 并发创建两次；同 map recovery contract 消费两次。
- 中途中断: task INSERT 与 receipt INSERT 之间异常；Map refresh 与 resume 之间进程退出；hook 验证后 receipt supersede。
- 边界值: credential 含 `@`/`:`/percent-encoding；detached HEAD；baseline 是祖先但相隔多次 RED/GREEN commit；Map 恰好跨 freshness 阈值。
发现分级: P0/P1（无 receipt 写仓、凭据泄露、活跃 cwd 删除、跨 repo、legacy_exempt）阻塞 merge；P2/P3 记录 findings。

