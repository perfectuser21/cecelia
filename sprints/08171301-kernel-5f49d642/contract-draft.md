# Sprint Contract Draft (Round 1)

**Sprint**: Diff Impact Gate 透传 reason_code 并 fail-closed 出口
**journey_type**: autonomous
**target_environment**: local_api
**contract-gate**: 适用（packages/brain/src/lib/contract-gate.js 存在，cecelia worktree，走代码层 Contract Gate + skill 内置规则）
**map**: `[MAP_NOT_CONFIGURED]`（task.payload.map_scope=["F1"] 但 map_repo 为空 → 不查 Unified Map radius；must_run_assertions=[]，不回退领域硬编码）
**gp-anchor**: skipped (product-map.json not found)

---

## Response Schema（推导来源: PRD 字面）

`N/A — 任务无 HTTP 响应`。本 sprint 全部改动落在 packages/brain 内部 kernel 调度逻辑（diff-gate/harness-gates/loop/derive），不新增/不修改任何 HTTP 端点。可观测契约是**函数返回结构**与 **orchestrator_decision_log 行结构**，已在下方 Golden Path 与 E2E 用 jq/psql/vitest 断言 codify。

被改函数返回结构（合同 ground truth，字段名字面不可漂移）：

- `evaluateDiffGate(...)` → `{ gate, reason, retryable, detail }`
  - 确定性结论：`{ gate:'blocked', reason:<原 freshness.reason_code>, retryable:false, detail:{ unclaimed_files:string[], capability_ids:string[] } }`
  - 真新鲜度：`{ gate:'impact_unknown', reason:'mapper_stale', retryable:true }`
  - 未知 reason_code：`{ gate:'impact_unknown', reason:'mapper_contract_invalid', retryable:false }`
- `beforeEvaluate(...)` 的 gateReceipt → 至少含 `{ stage, gate, reason, retryable, detail }`（detail 为上面的 detail 透传）
- `orchestrator_decision_log` 行 → `gate_verdict='deny:impact:<reason>'`，`detail.impact_gate={reason,retryable,detail}`

**禁用字段名**：`negation` / `stale`（作 reason 值时）/ 把确定性 reason_code 折叠成的 `mapper_stale`（确定性结论严禁再用 `mapper_stale`）。

---

## 锚定父路声明

独立小路（无父路）—— journey e6f803f2 的 golden-paths 返回空（PRD「累积 FR」段：本 line 暂无历史），本 sprint 为独立的 kernel 缺陷修复小路。

---

## Golden Path

[Generator 候选就绪，spawn:evaluator 前调 Diff Impact Gate] → [diff-gate 按 freshness.reason_code 三分类] → [确定性缺口 fail-closed，reason_code/retryable/detail 透传决策日志] → [derive 按 reason 路由 generator-fix / human_review，不再 90s 重试到 deadline]

---

### Step 1: diff-gate 按 reason_code 三分类，确定性结论 blocked+fail-closed
**来源**: `[FROM_PRD]` — PRD「系统处理」第 (a)(b)(c) 三分类 + 「范围限定」diff-gate.js

**可观测行为**: `evaluateDiffGate` 消费 mapper 结论时：
- (a) 真新鲜度 reason_code（`fact_snapshot_stale`/`projection_revision_missing`/`projection_revision_mismatch`/`manifest_projection_mismatch`/`graph_projection_revision_mismatch`）→ `impact_unknown/mapper_stale/retryable:true`（回归保护）
- (b) 确定性 reason_code（`impact_anchor_missing`/`capability_assertion_coverage_missing`/`capability_not_in_active_projection`/`unsafe_assertion_ref`/`assertion_identity_ambiguous`）→ `blocked/reason=<原 reason_code>/retryable:false` + `detail.unclaimed_files` + `detail.capability_ids`
- (c) 其余未知 reason_code → fail-closed `impact_unknown/mapper_contract_invalid/retryable:false`

**验证命令**:
```bash
npx vitest run sprints/08171301-kernel-5f49d642/tests/diff-gate-impact-reason-code.test.ts --reporter=basic
# 期望：8 个 it 全绿（含 5 条确定性 blocked + 2 条回归 mapper_stale + 1 条 fail-closed）
```

**硬阈值**: 确定性分支 gate='blocked' 且 retryable=false；回归分支 reason='mapper_stale' 且 retryable=true；未知分支 reason='mapper_contract_invalid' 且 retryable=false

---

### Step 2: harness-gates beforeEvaluate 的 gateReceipt 透传 reason/retryable/detail
**来源**: `[FROM_PRD]` — PRD「系统处理」`harness-gates.js beforeEvaluate 的 gateReceipt 透传 reason/retryable/detail`

**可观测行为**: 确定性 blocked 候选经真 `beforeEvaluate`（真 diff-gate + 真 DB 读 active contract）产出的 gateReceipt 含 `reason=impact_anchor_missing`、`retryable=false`、`detail.unclaimed_files` 非空（旧 gateReceipt 丢 detail → 运维无法判因）

**验证命令**:
```bash
npx vitest run sprints/08171301-kernel-5f49d642/tests/harness-gates-before-evaluate-passthrough.test.ts --reporter=basic
# 期望：gateReceipt.reason=impact_anchor_missing, retryable=false, detail.unclaimed_files=['DoD.md']
```

**硬阈值**: receipt.reason=='impact_anchor_missing' 且 receipt.retryable===false 且 receipt.detail.unclaimed_files.length>=1

---

### Step 3: derive 按 reason 路由确定性出口（不再退避重试到 deadline）
**来源**: `[FROM_PRD]` — PRD「系统处理」`derive.js 按 reason 路由`：impact_anchor_missing→generator-fix 一次→仍失败 human_review；capability_assertion_coverage_missing→human_review
**来源**: `[AI_ADDED]` — derive 读 orchestrator_decision_log 的 `detail.impact_gate`（loop.js:1514 落盘）作为路由信号，理由：impact 闸在 dispatch 前 blocked，本跳不进 derive 的 verdict 链，需下一跳从决策日志读回确定性结论按 reason 分流，避免复用可重试退避路径

**可观测行为**: 决策日志出现 `gate_verdict='deny:impact:impact_anchor_missing'` + `detail.impact_gate.retryable=false` 时，derive 下一跳返回 `spawn:generator-fix`（detail 携带 unclaimed_files）；本 head 已 fix 过一次仍同 reason → `wait:human_review`；`capability_assertion_coverage_missing` → 直接 `wait:human_review`

**验证命令**:
```bash
npx vitest run sprints/08171301-kernel-5f49d642/tests/derive-impact-deterministic-routing.test.ts --reporter=basic
# 期望：generator-fix / human_review 路由三例全绿
```

**硬阈值**: impact_anchor_missing 首次→action='spawn:generator-fix'；重复→action='wait:human_review'；coverage_missing→action='wait:human_review'

---

### Step 4: 出口 — 确定性 impact 结论落 orchestrator_decision_log（真库端到端）
**来源**: `[FROM_PRD]` — PRD「可观测结果」+「E2E 验收」+ NFR「可观测」

**可观测行为**: 真 diff-gate + 真 harness-gates + 真 appendHop 在 scratch 库写入 orchestrator_decision_log 一行：`gate_verdict='deny:impact:impact_anchor_missing'`，`detail.impact_gate.retryable=false`，`detail.impact_gate.detail.unclaimed_files` 非空

**验证命令**:
```bash
DB_URL="${DB_URL:?}" node sprints/08171301-kernel-5f49d642/e2e/impact-gate-decision-log-e2e.mjs
# 期望：stdout 打印 RUN_ID=<uuid> + OK；随后 psql 复核决策日志行（见 ## E2E 验收）
```

**硬阈值**: orchestrator_decision_log 存在满足上述三条件且 created_at 在 5 分钟窗口内的行 ≥1

---

## 已知约束（来自回归测试 + 累积 FR）

- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → FR-4 Diff Impact Gate：实际影响 ⊆ 声明影响放行(pass) / 新增影响触发 drift / Mapper 异常 fail-closed。**本 sprint 不得回退这些既有断言**（三分类是在 3a 之后细化，pass/extend/drift 仲裁路径不变）。
- [radius.js baseFreshness / resolveImpactRadius] → 真新鲜度 reason_code 集合（fact_snapshot_stale/projection_revision_missing/projection_revision_mismatch）与确定性 reason_code 集合（impact_anchor_missing/capability_assertion_coverage_missing/capability_not_in_active_projection/unsafe_assertion_ref/assertion_identity_ambiguous）由 radius 产出，本 sprint 不改 radius，只在 diff-gate 消费侧分类。
- [累积FR] → （本 line 暂无历史，PRD context-manifest 段空；journey e6f803f2 golden-paths 返回空）
- [context-manifest] → unavailable（journey 无累积 FR 摘要）

---

## 禁 mock 边清单

本单改动涉及**状态机（derive 路由/失败分类）+ 跨模块数据传递（diff-gate→harness-gates→loop→derive 的 reason_code/detail 接力）+ DB 写路径（orchestrator_decision_log）**，failing test 必须不 mock 被改的边：

- diff-gate ↔ mapper 结论消费（本单改了 diff-gate 对 mapper freshness.reason_code 的分类，单测必须真调 `evaluateDiffGate`，只 mock 更外层的 map-client mapper 返回值——radius.js/map-client 本 sprint 不改，属允许的外层边界）
- harness-gates(beforeEvaluate) ↔ diff-gate（本单改了 gateReceipt 对 diff-gate 结果 detail 的透传，harness-gates 单测必须真调 `beforeEvaluate` 且真调 `evaluateDiffGate`，二者都不 mock）
- derive ↔ orchestrator_decision_log 的 impact_gate 信号（本单新增 derive 读决策日志 detail.impact_gate 的路由，derive 单测真调纯函数 `derive`，不 mock；决策日志行结构与 loop.js:1514 落盘一致）
- 代码 ↔ orchestrator_decision_log 表（Final E2E 真 Postgres：真 appendHop 写、真 psql 读验，不 mock DB）

允许 mock 的**唯一外层边界**：map-client HTTP mapper（radius 响应回放/构造）—— radius 结论本身正确，PRD「范围限定」明确不改 radius/map-client。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | diff-gate 按 freshness.reason_code 三分类透传 reason_code/detail；确定性结论 retryable=false fail-closed；derive 按 reason 路由 generator-fix/human_review |
| **NFR（做得多好）** | 非功能 | 超时/频控 PrepPRD 未指定（N/A）；可观测：reason_code/retryable/unclaimed_files/capability_ids 必落 orchestrator_decision_log.detail.impact_gate；Brain semver 四处同步 + DevGate 三项过 |
| **Invariant（永不违反）** | 不变量 | ① 真新鲜度问题仍 retryable=true（回归保护，不误伤真 stale 的重试）；② 确定性结论 retryable 恒为 false（不无限重试）；③ 未知 reason_code fail-closed（绝不假绿放行）；④ [重试身份] 铁律：generator-fix 只重派 generator-fix，不改重试身份语义 |
| **判定点（怎么知道）** | 见下方登记表 | 见「判定点登记表」 |
| **保质期（何时过期）** | 失效 | reason_code 集合随 radius.js 演进；新增确定性 reason_code 未登记时由 (c) 分支 fail-closed 兜底（不会静默放行），退役由 radius owner 负责 |
| **死亡告警（停了谁知道）** | 告警 | 若三分类逻辑失效退回全 mapper_stale：orchestrator_decision_log 会重现「同 run 90s 重试到 deadline」→ run 以 automation_deadline_exceeded 终态，Brain run 监控可见（现状即此，本 sprint 消除之） |
| **失败语义（挂了怎么办）** | 见下 | 见「失败语义声明」 |
| **效果确认（已发≠已生效）** | 回执 | 确定性结论必须能在 orchestrator_decision_log 查到 `deny:impact:<reason>` 行（Final E2E psql 复核即回执），拿不到 = 未生效 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ mapper freshness 是「可重试新鲜度问题」还是「确定性覆盖缺口」 | A. 只看 status!=fresh 一律 retryable（现状,错）; B. 按 reason_code 白名单分类 | B. reason_code 白名单三分类 | reason_code 是 radius 的确定性判定输出，重试永不改变确定性缺口 | 误判为 A → 确定性缺口无限重试到 deadline（本 bug 根因）；误判确定性为可重试 → 空转烧算力 |
| 新出现的未登记 reason_code 归哪类 | A. 猜测归可重试; B. fail-closed 归 mapper_contract_invalid/retryable=false | B. fail-closed | 未知即不可判定，宁可拦不可假绿放行 | 误归可重试 → 未知缺口也无限重试；误放行 → 带缺陷候选进评估 |

> ⚠️ 行属「升拍板点」级别；PrepPRD 已在 PRD「系统处理」明确三分类白名单与 fail-closed 语义，判定点已拍定，无需再请教用户（不加 judgment-pending-user）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| mapper 返回真新鲜度 reason_code | impact_unknown/mapper_stale/retryable=true | 是（重试到 Map 刷新或 deadline） | 保持现状退避复探 |
| mapper 返回确定性 reason_code | blocked/retryable=false，derive 路由 generator-fix 或 human_review | 否（generator-fix 至多一次，仍失败转 human_review） | 走既有确定性出口，不退避 |
| mapper 返回未登记 reason_code | impact_unknown/mapper_contract_invalid/retryable=false | 否 | fail-closed，转确定性出口（不放行、不无限重试） |
| generator-fix 修一次仍同 reason | 走既有 no-progress / human_review 出口 | 否 | 不无限循环（PRD 边界情况第 3 条） |

### 输入对抗面

`N/A` — 本 sprint 无对外暴露 agent；输入来源是 Brain 内部 mapper 结论与本地决策日志，非外部用户可写入面。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## E2E 验收（final-e2e 跑 — target_environment=local_api，autonomous curl/psql 全程链路）

**journey_type**: autonomous
**target_environment**: local_api

> 数据写入类：真 migration bootstrap 空库 → 真 diff-gate/harness-gates/appendHop 落 orchestrator_decision_log → psql 时间窗复核。禁 mock 被改的边，唯一外层 mock=mapper（radius 响应）。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped scratch DB_URL}"

# 1. 空库跑仓库真实 migration bootstrap + 真闸驱动，落 orchestrator_decision_log。
#    驱动内部：runMigrations(空库) → 种子 task/active-contract/run → 真 beforeEvaluate(真 diff-gate + mock mapper)
#    → 真 appendHop 写决策日志；stdout 打印 RUN_ID=<uuid>。
OUT=$(node sprints/08171301-kernel-5f49d642/e2e/impact-gate-decision-log-e2e.mjs)
echo "$OUT"
RUN_ID=$(printf '%s\n' "$OUT" | sed -n 's/^RUN_ID=//p')
[ -n "$RUN_ID" ] || { echo "FAIL: 驱动未产出 RUN_ID"; exit 1; }

# 2. psql 复核：orchestrator_decision_log 新增确定性 impact 结论行（带 5 分钟时间窗防历史冒充）。
FOUND=$(psql "$DB_URL" -tAc "SELECT count(*) FROM orchestrator_decision_log WHERE run_id='$RUN_ID' AND gate_verdict='deny:impact:impact_anchor_missing' AND (detail->'impact_gate'->>'retryable')='false' AND jsonb_array_length(COALESCE(detail->'impact_gate'->'detail'->'unclaimed_files','[]'::jsonb)) >= 1 AND created_at > NOW() - INTERVAL '5 minutes'" | tr -d ' ')
[ "$FOUND" -ge 1 ] || { echo "FAIL: 决策日志缺确定性 impact 行 found=$FOUND"; exit 1; }

echo "OK: orchestrator_decision_log gate_verdict=deny:impact:impact_anchor_missing retryable=false unclaimed_files 非空"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: mapper 返回 `freshness.status='unknown'` 但 `reason_code` 为 null/空串 → 应归 (c) fail-closed（mapper_contract_invalid/retryable=false），不得当真新鲜度可重试
- 重复提交: 同一候选同 head 连续两跳都命中 impact_anchor_missing → 第二跳应 human_review 而非再 generator-fix（PRD 边界情况第 3 条 no-progress）
- 中途中断: impact_anchor_missing 但 `unclaimed_files` 为空数组（PRD 边界情况第 2 条）→ detail 仍带空数组字段，下游 generator-fix 判空转 human_review
- 边界值: mapper 同时含多个确定性条件 → 以 radius 返回的单一 freshness.reason_code 为准（消费方不聚合，PRD 边界情况第 1 条）
发现分级: P0/P1（确定性缺口又退回无限重试 / 未知 reason_code 被放行）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| diff-gate 三分类 | `tests/diff-gate-impact-reason-code.test.ts` | `impact_anchor_missing → blocked`；`capability_assertion_coverage_missing → blocked`；`fact_snapshot_stale`；`未知 reason_code` | 5 确定性+1 未知条目 expected 'impact_unknown' to be 'blocked'（Red） |
| 录制件回归 | `tests/diff-gate-recorded-fixture.test.ts` | `blocked:impact_anchor_missing/retryable=false` | expected 'impact_unknown' to be 'blocked'（Red） |
| gateReceipt 透传 | `tests/harness-gates-before-evaluate-passthrough.test.ts` | `gateReceipt.reason=impact_anchor_missing` | expected 'mapper_stale' to be 'impact_anchor_missing'（Red） |
| derive 路由 | `tests/derive-impact-deterministic-routing.test.ts` | `spawn:generator-fix`；`wait:human_review` | 路由 action 不符（Red） |

> 「BEHAVIOR 覆盖」列每名均为对应 it() 测试名的字面子串（vitest -t 可命中）。

---

## 未覆盖真实链路清单

1. **mapper（map-client HTTP / radius 真实投影）在所有测试与 E2E 中以构造/录制响应顶替**——理由：radius.js 结论本身正确且 PRD「范围限定」明确不改 radius/map-client，本 sprint 只改消费方 diff-gate；真验证补位：radius 的 reason_code 产出由其自身既有测试覆盖（另域），本单只需保证消费侧分类正确。
2. **loop.js 的 failure_class 归类与「retryable=false 不退避」控制流、以及完整 runLoop 单跳**：Final E2E 复现 loop.js:1453-1454（gateVerdict 串）与 :1514（detail.impact_gate 落盘）这两行**未改逻辑**以产出决策日志真行，但未在 E2E 中驱动整条 runLoop（deps 夹具重）；loop/derive 的 retryable=false→impact_contract_invalid→按 reason 路由由纯单测 `derive-impact-deterministic-routing.test.ts` 覆盖，永久集成回归由 Generator 复制到 `packages/brain/src/__tests__/integration/`（brain-integration job 真 Postgres 跑）补位。

---

## 接缝清单（接缝断言 vs 逻辑断言）

| # | 接缝点 | 类型 | 真目标验证方式 | done 判定 |
|---|--------|------|----------------|-----------|
| 1 | diff-gate reason_code 分类（纯逻辑） | 逻辑断言 | vitest 单测（环境无关） | 绿=done |
| 2 | 代码 ↔ orchestrator_decision_log 真库写读 | 接缝断言 | Final E2E 真 Postgres appendHop 写 + psql 读验（scratch DB_URL） | 真库验过才 done；未真验标 logic-done-pending |
| 3 | derive 读决策日志 detail.impact_gate 路由 | 逻辑断言（纯函数） | vitest 单测（decisionLog 行结构与 loop 落盘一致） | 绿=done |

无写死环境假设值（无屏幕坐标/UIA 阈值/假 env）；接缝 2 由 Fleet 注入 scratch DB_URL 真验。
