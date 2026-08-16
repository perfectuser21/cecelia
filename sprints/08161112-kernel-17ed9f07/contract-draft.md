# Sprint Contract Draft (Round 1)

## 锚定父路声明

独立小路（无父路）— 本 sprint 打通 Commander 入口透传链路，F1 线 journey `e6f803f2` 累积 FR 为空（PRD 第 88 行「本 line 暂无历史」），无既有 Golden Path 步骤可锚定。

gp-anchor: skipped (product-map.json not found)

contract-gate: cecelia worktree（`packages/brain/src/lib/contract-gate.js` 存在），本合同断言按 Contract Gate 惯用法速查表书写。

## Response Schema（推导来源: PRD 字面 + api_registry 推导 + 现有 commander-profile.js / harness-commander.js schema）

### Endpoint: POST /api/brain/tasks（新增入参，成功响应沿用现有 task 行，无字段改名）

**新增请求字段（body，全部可选）**:
```json
{"commander_mode": "legacy-session|kernel-only|hybrid", "commander_profile": {"primary": {"provider": "string", "account": "string", "model?": "string", "machine?": "string"}, "fallbacks": []}, "commander_retry_budget": 2}
```
- `commander_mode` (string 枚举, 可选): 来源——PRD 第 19 行字面；合法值 = `commander-contract.js` `COMMANDER_MODES`（`legacy-session`/`kernel-only`/`hybrid`），缺省交由下游默认逻辑。
- `commander_profile` (object, 可选): 来源——PRD 第 19 行 + `commander-profile.js` `commanderProfileSchema`（`.strict()`，`{primary, fallbacks[≤3]}`，`target={provider,account,model?,machine?}` 全 `.strict()`）。
- `commander_retry_budget` (int, 可选): 来源——PRD 第 19 行 + loop.js:748 现读 `payload.commander_retry_budget`（clamp 0..8，缺省 2）。

**Success (HTTP 201)**: 沿用现有 task 行 schema（`id`/`title`/`status`/`payload`...），本单不改字段名。落库副作用：`tasks.payload.commander_mode`、`tasks.payload.commander`（profile）、`tasks.payload.commander_retry_budget` 三字段写入。

**Error (HTTP 400 — 非法 commander_profile)**:
```json
{"error": "invalid_commander_profile", "reason_code": "invalid_commander_profile"}
```
- `error` (string): **字面** `invalid_commander_profile`（PRD 第 22/32 行字面，禁改名为 `bad_profile`/`profile_invalid` 等同义词）。触发条件：`commander_mode=hybrid` 且 `commander_profile` 含未知键（如历史 `strict_affinity`）/缺 `primary`/`fallbacks>3`/重复 target → zod `.strict()` 抛错 → 400，**不落库**。

**禁用字段名**（api_registry / 现有 schema 同义替换词，contract 断言里禁止出现）: `bad_profile`、`profile_invalid`、`commander_config`（正确 payload key 是 `commander`）、`commanderMode`（HTTP body 用 snake_case `commander_mode`）。

### Endpoint: GET /api/brain/harness-commander/runs/:runId/commander（现有只读端点，本单不改 schema，仅验产出）

**Success (HTTP 200)**（`harness-commander.js:48` `commanderResponse` 字面）:
```json
{"run_id": "uuid", "commander_mode": "hybrid", "provider": "string|null", "account_id": "string|null", "event_cursor": 0, "status": "string", "strategy_summary": {}, "active_risks": [], "latest_guidance": null}
```
- `event_cursor` (number, 必填): 单调递增（NFR 第 65 行）。
- `status` (string, 必填): commander state 状态。

---

## Golden Path

[一条 F1 编码任务 `POST /api/brain/tasks`] → [Work Router `createRoutedTask` 透传 commander_mode/profile/retry_budget + F1 未指定默认 hybrid] → [分发层读 `payload.commander_mode` 传给 `createKernelRun` → 写 `initiative_runs.commander_mode`] → [hybrid run 首跳召唤 Commander，directive_accepted 后才派 Planner] → [FR-2 必唤醒节点全程指挥，bundle 看得见闸真实结论] → [真 canary run 落 ≥5 条 `commander.directive_accepted` + ≥1 条异常唤醒被 kernel 执行/记 request_human]

### Step 1: POST /tasks 接受并校验 commander_mode/commander_profile/commander_retry_budget
**来源**: `[FROM_PRD]` — PRD 第 19、22、32 行（入口三字段 + 非法 profile 400）。

**可观测行为**: 带 `commander_mode=hybrid` + 合法 `commander_profile` → 201，落库 `tasks.payload.commander_mode='hybrid'` 与 `payload.commander`；带未知 profile 键 → 400 `invalid_commander_profile`，不落库。

**验证命令**:
```bash
# 合法：201 且 payload 落三字段（vitest 覆盖 store 层；route 400 见下方 curl）
cd /workspace/packages/brain && npx vitest run --config ../../sprints/08161112-kernel-17ed9f07/tests/vitest.config.ts commander-entry-threading
# 非法 profile 键 → 400（curl 真打 live Brain）
CODE=$(curl -s -o /tmp/badprof.json -w "%{http_code}" -X POST localhost:5221/api/brain/tasks -H 'Content-Type: application/json' -d '{"title":"gate-probe invalid profile","task_type":"harness_initiative","change_kind":"bugfix","commander_mode":"hybrid","commander_profile":{"primary":{"provider":"codex","account":"team2"},"strict_affinity":true}}')
[ "$CODE" = "400" ] && jq -e '.error=="invalid_commander_profile"' /tmp/badprof.json
```
**硬阈值**: 合法 vitest exit 0；非法 `HTTP 400` 且 `error=="invalid_commander_profile"`。

---

### Step 2: Work Router F1 默认 hybrid + 默认 profile 注入
**来源**: `[FROM_PRD]` — PRD 第 21 行（未显式 + map_scope 含 F1/journey e6f803f2 → 默认 hybrid + 默认 profile；显式 kernel-only 可关；其他线不变）。

**可观测行为**: `createRoutedTask` 收到 `map_scope=['F1']` 的 `coding_mutation` 任务且未带 `commander_mode` → 写 `payload.commander_mode='hybrid'` + 默认 profile `primary={provider:'codex',account:'team2',machine:'us-mac-m4'}`、`fallbacks=[{provider:'claude',account:'account2',machine:'us-mac-m4'}]`；显式 `kernel-only` → 落 `kernel-only`；非 F1 未带 → 不注入 commander_mode（下游缺省 kernel-only）。

**验证命令**:
```bash
cd /workspace/packages/brain && npx vitest run --config ../../sprints/08161112-kernel-17ed9f07/tests/vitest.config.ts commander-entry-threading
```
**硬阈值**: 4 个 case（默认 hybrid / 显式 kernel-only / 非 F1 无注入 / 透传显式 profile）全绿，vitest exit 0。

---

### Step 3: 分发层透传 commander_mode → createKernelRun → initiative_runs.commander_mode
**来源**: `[FROM_PRD]` — PRD 第 20、55 行（`createKernelRun` 接收并写 `initiative_runs.commander_mode`；receipt evidence 记来源）。
**AI 补充理由**: `[AI_ADDED]` — GAN Round 1，分发层 `harness-skill-relay.js:271` / `headed-kernel-runtime.js:84` 现调 `createKernelRun` 未传 `commanderMode`（缺省 kernel-only，见 `kernel-run-store.js:101`），是「Commander 永远不被召唤」的真实断点，必须补测防回归。

**可观测行为**: 分发层从 `task.payload.commander_mode` 读值并作为 `createKernelRun` 入参 `commanderMode` 传入；hybrid 任务 → `initiative_runs.commander_mode='hybrid'`。

**验证命令**:
```bash
# 单元：捕获 createKernelRun 入参 commanderMode（分发侧参数构造）
cd /workspace/packages/brain && npx vitest run --config ../../sprints/08161112-kernel-17ed9f07/tests/vitest.config.ts commander-entry-threading
# 真 PG 持久化：canary run 的 initiative_runs.commander_mode（见 ## E2E 验收）
psql "$DB_URL" -tAc "SELECT commander_mode FROM initiative_runs WHERE commander_mode='hybrid' AND started_at > NOW() - interval '3 hours' LIMIT 1" | grep -qx hybrid
```
**硬阈值**: 单元捕获 `commanderMode='hybrid'`；canary initiative_runs.commander_mode='hybrid'（真 PG）。

---

### Step 4: hybrid run 起手召唤 + FR-2 必唤醒节点（首跳先于 Planner；同一 gate_verdict 连续 ≥3 跳唤醒；单次 capacity_contended 不唤醒）
**来源**: `[FROM_PRD]` — PRD 第 23、24 行（首跳 Commander 唤醒→directive_accepted 后派 Planner；连续无进展=同一 gate_verdict 连续≥3 跳唤醒；单次瞬时故障不唤醒）。

**可观测行为**: hybrid run 第一跳产出 Commander dispatch（`run.created` 材料事件）且 Planner 派发发生在 `commander.directive_accepted` 之后；同一 `gate_verdict` 连续 3 跳无进展 → 触发唤醒；单次 `capacity_contended` → 不唤醒（`continue`）。

**验证命令**:
```bash
cd /workspace/packages/brain && npx vitest run --config ../../sprints/08161112-kernel-17ed9f07/tests/vitest.config.ts commander-wakeup-nodes
```
**硬阈值**: 三 case（首跳唤醒 / 3 跳无进展唤醒 / 单次 capacity 不唤醒）全绿。

---

### Step 5: commander-bundle activeRisks 看得见闸真实结论 + 跨 run 隔离
**来源**: `[FROM_PRD]` — PRD 第 25、35 行（impact_gate.reason/retryable/detail、admission_reasons、attempt.error_code/failure_class 进 activeRisks；不同 run 合同/反馈不进本 run bundle）。

**可观测行为**: coordinator 构造 dispatch bundle 时，`active_risks` 含 observed 的 `impact_gate.{reason,retryable}`、`admission_reasons`、最近 attempt 的 `error_code/failure_class`；传入他 run 事件 → `buildCommanderBundle` 抛 `commander_bundle_run_mismatch`（隔离铁闸）。

**验证命令**:
```bash
cd /workspace/packages/brain && npx vitest run --config ../../sprints/08161112-kernel-17ed9f07/tests/vitest.config.ts commander-bundle-gates
```
**硬阈值**: activeRisks 含三类闸结论 + 跨 run 事件被拒，全绿。

---

### Step 6: 真 canary（数据写入类）落全程 Commander 事件
**来源**: `[FROM_PRD]` — PRD 第 26 行 + 验收段（≥5 条 directive_accepted 分布于 5 唤醒点；≥5 harness_attempts role=commander completed；event_cursor 单调；≥1 条异常唤醒 action ∈ 异常集被 kernel 执行/记 request_human）。
**AI 补充理由**: `[AI_ADDED]` — 真 canary 是接缝断言（真 provider codex team2 真机 us-mac-m4 全程），CI/mock 绿 ≠ done，必须真目标 psql 验（防「有枪没上膛」#1256 式漏机）。

**可观测行为**: 一条真实 F1 bugfix 任务以 hybrid 从头跑，`orchestrator_decision_log` 该 run 出现 ≥5 条 `action='commander.directive_accepted'`，`harness_attempts` role='commander' ≥5 条 completed，observation 端点 `event_cursor` 单调，≥1 条 directive `action` ∈ {retry_attempt,switch_provider,switch_machine,revise_guidance,pause_run,request_human}。

**验证命令**（见 ## E2E 验收 完整脚本）:
```bash
psql "$DB_URL" -tAc "SELECT count(*) FROM orchestrator_decision_log dl JOIN initiative_runs r ON r.id=dl.run_id WHERE r.commander_mode='hybrid' AND r.started_at > NOW() - interval '3 hours' AND dl.action='commander.directive_accepted'" | tr -d ' '
```
**硬阈值**: count ≥ 5；异常唤醒 directive action ∈ 异常集 ≥ 1。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | POST /tasks + Work Router 透传 commander_mode/commander_profile/commander_retry_budget；F1 线未指定默认 hybrid+默认 profile；hybrid run 起手召唤 Commander 且 directive_accepted 先于 Planner；FR-2 必唤醒节点（含同一 gate_verdict 连续≥3 跳、单次 capacity_contended 不唤醒）；commander-bundle activeRisks 看得见闸真实结论；一条真 canary 全程事件产出。 |
| **NFR（做得多好）** | 性能/可靠性/并发 | 三字段全链不丢；`event_cursor` 单调递增；跨 run 隔离；门禁不可绕过（kernel 唯一执行权）；Brain semver 四处同步 + DevGate 三项全过。 |
| **Invariant（永不违反）** | 不变量 | Commander 不得获得绕过 impact_gate/admission/diff-gate 的能力；kernel 保留唯一执行权；重试保持 retry_of/logical_cycle_id 身份、终态 Attempt 不复活、跨 provider/机器不复用旧 Session ID（约束 retry_attempt/switch_provider/switch_machine）；单槽串行；target_environment 从 tasks.payload 读；planner 绑定 server 签发 role branch。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | F1 默认 profile 硬编码 `codex/team2` 与 `claude/account2`；provider account 退役或 capability snapshot 变更后默认 profile 需更新，否则 canary 全程 failover→request_human。默认 F1 判定（map_scope 含 'F1' / journey e6f803f2）随 F1 line 归属变更失效。 |
| **死亡告警（停了谁知道）** | 告警手段 | hybrid run 全程 0 条 directive_accepted 或 Commander attempt 连续 failed → coordinator failover exhausted → decision log 写 `request_human` / `wait:human_review`；observation 端点 `status` 暴露；canary psql 断言即巡检。 |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明表 |
| **效果确认（已发≠已生效）** | 回执方式 | `initiative_runs.commander_mode` 落库 + `orchestrator_decision_log` `commander.directive_accepted` 落行 + `GET /runs/:runId/commander` event_cursor 单调；三处任一缺失即未生效。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息 |
| 任务是否「F1 归属」（触发默认 hybrid） | A. map_scope 含字符串 `F1`; B. journey_id=`e6f803f2`; C. 两者任一 | C. 两者任一（且 work_kind=coding_mutation） | PRD 第 21/49 行显式定义 | 误判为 F1→非 F1 线多召 Commander（成本）；漏判→F1 退回 kernel-only 无监工（Commander 不可达回归） |
| 是否「连续无进展」需异常唤醒 | A. 同一 gate_verdict 连续≥3 跳; B. 任意重复事件 | A. 同一 gate_verdict 连续≥3 跳 | PRD 第 24 行显式；避免普通心跳/单次瞬时 503 误唤醒 | 阈值过松→过度唤醒成本；过紧→卡死场景漏唤醒（今晚 Impact 闸空转 130 跳即此类） |
| ⚠️ Commander 自由文本指令是否可触发副作用 | A. 无条件执行; B. 经 commander-contract schema+证据+游标+合法 action 校验，缺则记 invalid 不执行 | B. schema 校验后经 directive-executor 由 kernel 执行 | PRD 第 36 行（自由文本不得直接触发副作用）+ Invariant（kernel 唯一执行权） | 越权执行=Commander 绕过门禁，直接面客/不可逆动作；⚠️ 属升拍板级 |

judgment-pending-user: Commander 自由文本指令是否可触发副作用（已由现有 commander-contract/directive-executor 覆盖，本单不改执行权，仅确认不回退）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503 不写 DB | 是（幂等键=task_id） | 客户端重试 |
| POST /tasks 非法 commander_profile | 返回 400 `invalid_commander_profile`，**不落库**（拦截，非放行） | 是（无副作用） | 调用方修正 profile 重提 |
| commander_mode 字段缺失/未传 | 下游缺省 `kernel-only`（安全侧，非 hybrid） | 是 | 存量 160 条路径零变化 |
| Commander attempt 失败（infrastructure_blocked/runner_failure + 可 failover code） | coordinator failover 到 fallback target（保持 logical_cycle_id 身份） | 是（retry_of 身份不复活终态） | fallbacks 耗尽→`request_human`，不绕门禁 |
| Commander 语义拒绝 / 非 failover 故障 | `stopForHuman` → `wait:human_review` | 否 | 人审 |

### 输入对抗面（对外暴露 agent）

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| Commander（provider-neutral LLM 监工）自由文本输出 | 半信任 | commander-contract `assertNoSecretMaterial` + `parseCommanderDirective` schema（缺 schema/证据引用/游标/合法 action → 记 invalid 建议，不触发副作用） | 非白名单 action / 缺 event_cursor → directive-executor 拒绝执行；kernel 保留唯一执行权，Commander 不得绕过 impact_gate/admission/diff-gate |
| 调用方 body `commander_profile` | 半信任 | `commanderProfileSchema.strict()` 拒未知键（400 invalid_commander_profile） | 未知键/重复 target/fallbacks>3 → 400，不落库 |

## 已知约束（来自回归测试 + 累积 FR）

- [work-routing-store.integration.test.js] createRoutedTask 提交 canonical coding task + immutable receipt 在同一 connection；map_scope 含 F1 场景已有（`authoritative_scope` → `[{node_key:'F1'}]`）。
- [kernel-run-store.test.js] createKernelRun `validateCreateInput` 缺省 commander_mode → `kernel-only`；非法 mode throw `invalid Kernel run commander mode`。**本单不改此缺省语义**（缺省仍 kernel-only），只让分发层显式传 hybrid。
- [commander-coordinator.test.js] reconcile：非 hybrid → `{kind:'bypass'}`；material 事件 → dispatch；attempt inflight → wait；failover 生命周期完整。**本单只新增唤醒节点判定，不改 failover 语义**。
- [commander-bundle.test.js] buildCommanderBundle 校验 run_id 匹配（`commander_bundle_run_mismatch`）+ cursor 单调 + assertNoSecretMaterial。**跨 run 隔离是既有铁闸，本单加 activeRisks 内容不得破坏它**。
- [累积FR] journey e6f803f2 本 line 暂无历史（PRD 第 88 行），无既往验收行为可回退。
- [MAP_NOT_CONFIGURED] 本 attempt 未取到 Unified Map radius（map_scope/repo 未随 task.payload 注入 map_scope），must_run_assertions 为空，按 PRD 字面 + 现有测试约束书写，未回退到领域硬编码。

## 禁 mock 边清单

本单涉及跨模块数据传递 + DB 写路径 + 调度唤醒判定，以下边**禁 mock**（generator 测试命中即 CONTRACT-IS-LAW FAIL）：

- routes/task-tasks POST ↔ work-routing-store `createRoutedTask`（本单改了透传字段：route 集成测试必须真调 store，或走 integration 真 PG，不得 stub 掉 createRoutedTask 的 payload 落库结果）
- work-routing-store `createRoutedTask` ↔ `tasks` 表 payload（DB 写路径：`payload.commander_mode`/`payload.commander` 落库必须真 PG 验——canary/integration 真 Postgres，单元 fake client 只验决策逻辑不算落库真验）
- 分发层 `harness-skill-relay.js`/`headed-kernel-runtime.js` ↔ `createKernelRun`（跨模块传递 `commander_mode`：单元可捕获入参验参数构造，但 `initiative_runs.commander_mode` 真落库必须 canary/integration 真 PG 验，不得只靠 fake createKernelRun 收尾）
- `createKernelRun` ↔ `initiative_runs` 表（DB 写 `commander_mode` 列：真 PG 验）
- `commander-coordinator` ↔ `commander-wakeup`/`commander-bundle`（跨模块调度判定：coordinator 测试必须 import 真实 wakeup/bundle 模块，只允许 mock 更外层 `commanderStore`/`eventStore`/`attemptStore`；不得 mock classifyCommanderWakeup/buildCommanderBundle 本体）

需真 PG 的测试放 `packages/brain/src/__tests__/integration/` 命名（`*.integration.test.js` / `*.pg.integration.test.js`），CI 由 brain-integration job 起真 Postgres 跑。

## 接缝清单（碰真实世界的点，未真验标 logic-done-pending）

1. **真 canary 全程 provider run**（codex team2 真机 us-mac-m4 + claude account2 fallback）——接缝×2（真 provider + 异步全程）。真目标验证：`psql orchestrator_decision_log` ≥5 条 `commander.directive_accepted` + `harness_attempts` role=commander ≥5 completed。未跑真 canary 前标 `logic-done-pending`。
2. **initiative_runs.commander_mode 持久化**——DB 写路径接缝。真目标验证：canary psql 查列值（真 PG），不接受 fake client 收尾。
3. **分发层→createKernelRun commander_mode 透传**——跨模块接缝。真目标验证：integration/canary 真 PG 查 initiative_runs.commander_mode。

## 未覆盖真实链路清单

- **Commander LLM directive 真实生成**（真 provider 出 directive）：单元测试用注入的 fake directive（`latestAttempt.result.decision`）验 coordinator 判定路径，**真 directive 由 canary 真 provider 产出**——单元侧 mock 属「更外层 provider 调用」豁免，真验补位 = 真 canary（Step 6）。规则 C 登记：mock 点=commander attempt result；原因=单元不启真 provider（成本/非确定）；真验补位=Step 6 canary（真 codex team2，本 sprint 内）。
- 其余链路（透传/唤醒判定/bundle 组装）单元真跑真断言，无 mock 豁免。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `POST /api/brain/tasks` 传 `commander_mode="hybrid-typo"`（非枚举）→ 期望 400/拒绝，不落半态；`commander_retry_budget=-1` / `999` → 期望 clamp 到 0..8 不崩。
- 重复提交: 同 `source_id`/`idempotency-key` 连发两次带 commander_mode → 期望幂等命中同 task，commander 字段一致不冲突（`work_route_idempotency_conflict` 不误触发）。
- 中途中断: hybrid run 首跳 Commander dispatch 后 kill Commander attempt → 期望 failover 而非 Planner 抢跑（directive_accepted 未落不得派 Planner）。
- 边界值: `commander_profile.fallbacks` 恰好 3 个 / 4 个（4 个应 400）；`primary` 与某 fallback 完全相同 target → 期望 `commander_target_duplicate` 400。
发现分级: P0/P1（Commander 绕过门禁 / 跨 run 上下文串味 / 非 F1 线被误改默认）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 说明：本 sprint 为 Brain 纯后端调度/接线（autonomous）。逻辑断言由 vitest 单测覆盖（透传/唤醒判定/bundle 组装，环境无关）；接缝断言（commander_mode 真落库 + 真 canary 全程 provider 事件）由本脚本真 PG + 真 provider run 验。脚本触发一条真实 F1 bugfix 任务以 hybrid 从头跑，再对同一 attempt 隔离库 psql 断言全程 Commander 事件。DB_URL 由 Fleet 注入。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
BASE_URL="${BASE_URL:-http://127.0.0.1:5221}"
SPRINT_DIR="sprints/08161112-kernel-17ed9f07"

# 0. 目标表存在（空库/真库均机检）
for t in initiative_runs orchestrator_decision_log harness_attempts; do
  psql "$DB_URL" -tAc "SELECT to_regclass('public.$t') IS NOT NULL" | grep -qx t || { echo "FAIL: 缺表 $t"; exit 1; }
done

# 1. 逻辑断言：透传/唤醒/bundle 单测全绿（环境无关）
( cd packages/brain && npx vitest run \
    "../../${SPRINT_DIR}/tests/commander-entry-threading.test.ts" \
    "../../${SPRINT_DIR}/tests/commander-wakeup-nodes.test.ts" \
    "../../${SPRINT_DIR}/tests/commander-bundle-gates.test.ts" ) || { echo "FAIL: 合同单测未全绿"; exit 1; }

# 2. 非法 commander_profile → 400 invalid_commander_profile（不落库）
BADCODE=$(curl -s -o /tmp/e2e-badprof.json -w "%{http_code}" -X POST "$BASE_URL/api/brain/tasks" \
  -H 'Content-Type: application/json' \
  -d '{"title":"e2e invalid commander profile probe","task_type":"harness_initiative","change_kind":"bugfix","commander_mode":"hybrid","commander_profile":{"primary":{"provider":"codex","account":"team2"},"strict_affinity":true}}')
[ "$BADCODE" = "400" ] || { echo "FAIL: 非法 profile 未返 400 (got $BADCODE)"; exit 1; }
jq -e '.error=="invalid_commander_profile"' /tmp/e2e-badprof.json >/dev/null || { echo "FAIL: 400 body 非 invalid_commander_profile"; exit 1; }

# 3. 触发真 canary：一条真实 F1 bugfix，未带 commander_mode → 期望默认 hybrid
TS=$(date +%s)
RESP=$(curl -sf -X POST "$BASE_URL/api/brain/tasks" -H 'Content-Type: application/json' \
  -d "{\"title\":\"canary F1 commander wakeup ${TS}\",\"description\":\"real F1 bugfix canary for commander full-run wakeup\",\"task_type\":\"harness_initiative\",\"change_kind\":\"bugfix\",\"map_scope_hint\":[\"F1\"],\"repo_hint\":\"perfectuser21/cecelia\",\"journey_id\":\"e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29\"}")
CANARY_TASK_ID=$(echo "$RESP" | jq -er '.id')
echo "canary task_id=$CANARY_TASK_ID"

# 4. 等待 run 产生并拿 run_id（run 由调度器起；预算 10 分钟）
CANARY_RUN_ID=""
DEADLINE=$((SECONDS+600))
until [ -n "$CANARY_RUN_ID" ]; do
  CANARY_RUN_ID=$(psql "$DB_URL" -tAc "SELECT id FROM initiative_runs WHERE current_task_id='$CANARY_TASK_ID' AND orchestrator_version='v2' ORDER BY started_at DESC LIMIT 1" | tr -d ' ')
  [ -n "$CANARY_RUN_ID" ] && break
  [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: within 600s 未见 canary run"; exit 1; }
  sleep 5
done
echo "canary run_id=$CANARY_RUN_ID"

# 5. commander_mode 真落库 = hybrid（F1 默认；接缝断言，真 PG）
MODE=$(psql "$DB_URL" -tAc "SELECT commander_mode FROM initiative_runs WHERE id='$CANARY_RUN_ID'" | tr -d ' ')
[ "$MODE" = "hybrid" ] || { echo "FAIL: canary commander_mode=$MODE (期望 hybrid)"; exit 1; }

# 6. 等待全程 Commander 事件：≥5 条 directive_accepted（预算 45 分钟，真 provider 全程）
DEADLINE=$((SECONDS+2700))
until psql "$DB_URL" -tAc "SELECT count(*) FROM orchestrator_decision_log WHERE run_id='$CANARY_RUN_ID' AND action='commander.directive_accepted'" | tr -d ' ' | awk '{exit !($1>=5)}'; do
  [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: within 2700s 未见 ≥5 条 directive_accepted"; \
    psql "$DB_URL" -tAc "SELECT action,count(*) FROM orchestrator_decision_log WHERE run_id='$CANARY_RUN_ID' GROUP BY action ORDER BY 1"; exit 1; }
  sleep 15
done
DA=$(psql "$DB_URL" -tAc "SELECT count(*) FROM orchestrator_decision_log WHERE run_id='$CANARY_RUN_ID' AND action='commander.directive_accepted'" | tr -d ' ')
echo "directive_accepted=$DA"

# 7. harness_attempts role=commander completed ≥5
CA=$(psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts WHERE run_id='$CANARY_RUN_ID' AND role='commander' AND status='completed'" | tr -d ' ')
[ "$CA" -ge 5 ] || { echo "FAIL: commander completed attempts=$CA (<5)"; exit 1; }

# 8. observation 端点 status + event_cursor 单调（两次取样，后次 >= 前次）
C1=$(curl -sf "$BASE_URL/api/brain/harness-commander/runs/$CANARY_RUN_ID/commander" | jq -er '.event_cursor')
curl -sf "$BASE_URL/api/brain/harness-commander/runs/$CANARY_RUN_ID/commander" | jq -e '.status|type=="string"' >/dev/null || { echo "FAIL: commander status 非 string"; exit 1; }
sleep 2
C2=$(curl -sf "$BASE_URL/api/brain/harness-commander/runs/$CANARY_RUN_ID/commander" | jq -er '.event_cursor')
[ "$C2" -ge "$C1" ] || { echo "FAIL: event_cursor 非单调 ($C1 -> $C2)"; exit 1; }

# 9. ≥1 条异常唤醒 directive action ∈ 异常集，被 kernel 执行/记 request_human
EXC=$(psql "$DB_URL" -tAc "SELECT count(*) FROM orchestrator_decision_log WHERE run_id='$CANARY_RUN_ID' AND action='commander.directive_accepted' AND (detail->'directive'->>'action') IN ('retry_attempt','switch_provider','switch_machine','revise_guidance','pause_run','request_human')" | tr -d ' ')
[ "$EXC" -ge 1 ] || { echo "FAIL: 无异常唤醒 directive (retry/switch/revise/pause/request_human)"; exit 1; }

# 10. 跨 run 隔离 sanity：该 run 的 directive detail 不含他 run id 串味（bundle run 校验的最终体现）
LEAK=$(psql "$DB_URL" -tAc "SELECT count(*) FROM orchestrator_decision_log WHERE run_id='$CANARY_RUN_ID' AND (detail->'directive') IS NOT NULL AND detail::text LIKE '%\"run_id\":%' AND detail::text NOT LIKE '%'||'$CANARY_RUN_ID'||'%'" | tr -d ' ')
[ "$LEAK" = "0" ] || { echo "FAIL: directive detail 含他 run_id 串味 count=$LEAK"; exit 1; }

echo "✅ 真 canary Golden Path 验证通过 run=$CANARY_RUN_ID directive_accepted=$DA commander_completed=$CA exceptional=$EXC"
```

**通过标准**: 脚本 exit 0（单测全绿 + 400 拦截 + commander_mode 真落 hybrid + ≥5 directive_accepted + ≥5 commander completed + event_cursor 单调 + ≥1 异常唤醒 + 无串味）。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 入口透传 + F1 默认 + 分发 commanderMode | `tests/commander-entry-threading.test.ts` | `commander_mode into task payload`；`F1 map_scope defaults to hybrid`；`explicit kernel-only respected`；`dispatch passes commander_mode to createKernelRun` | → 4 failures（现 store/分发不透传） |
| 起手召唤 + FR-2 唤醒节点 | `tests/commander-wakeup-nodes.test.ts` | `first hop wakes commander before planner`；`same gate_verdict three hops wakes`；`single capacity_contended does not wake` | → 3 failures（现 wakeup 无 3-跳/gate 逻辑） |
| bundle activeRisks 闸结论 + 隔离 | `tests/commander-bundle-gates.test.ts` | `active_risks carries impact_gate reason retryable`；`active_risks carries admission_reasons and error_code`；`rejects cross run event` | → 2+ failures（现 activeRisks 不含闸结论） |
