# Sprint Contract Draft (Round 1)

> journey_type: autonomous ｜ target_environment: local_api ｜ journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
> gp-anchor: skipped (product-map.json not found)
> contract-gate: skipped (file not found — 已确认 packages/brain/src/lib/contract-gate.js 不存在，第三方门禁不适用，走 skill 内置规则)
> unified-map: [MAP_NOT_CONFIGURED] map_repo=null 且 expected_files=[]，无法计算 radius/must_run_assertions；本单不回退领域硬编码，按 PRD 明列受影响文件为准。

## Golden Path

覆盖父路 e6f803f2（provider-neutral Harness Commander fusion）—— 独立小路（无父路）：journey e6f803f2 现有 golden-path 均为 planned 态，本 sprint 打通「入口透传 → F1 默认 hybrid → 起手召唤 → 真 canary 全程唤醒」这条尚未落地的起手链路，无已验收父路步骤可依赖。

[POST /tasks 入口] → [Work Router 透传 commander_* + F1 默认 hybrid] → [createKernelRun 落 initiative_runs.commander_mode] → [hybrid run 首跳起手召唤 Commander，directive_accepted 后才派 Planner] → [FR-2 必唤醒节点全程接线 + bundle 读到闸真实结论] → [真 canary F1 bugfix run 产出全程 Commander 事件]

---

### Step 1: POST /api/brain/tasks 接受并校验 commander_mode / commander_profile / commander_retry_budget
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步 + 边界情况「非法 commander_profile → 400 invalid_commander_profile」（第 18、26 行）

**可观测行为**: 调用方可在请求体带 `commander_mode`(legacy-session|kernel-only|hybrid)、`commander_profile`({primary:{provider,account,model?,machine?}, fallbacks[]}，严格 schema)、`commander_retry_budget`；未知 profile 键（如 strict_affinity）被拒。

**验证命令**:
```bash
# 非法 profile 键 → 400 invalid_commander_profile（route 层校验，先于路由）
CODE=$(curl -s -o /tmp/cp.json -w "%{http_code}" -X POST localhost:5221/api/brain/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"cp-invalid-'"$RANDOM"'","change_kind":"bugfix","mutation_intent":"write","commander_mode":"hybrid","commander_profile":{"primary":{"provider":"codex","account":"team2","machine":"us-mac-m4"},"strict_affinity":true}}')
[ "$CODE" = "400" ] && jq -e '.error=="invalid_commander_profile"' /tmp/cp.json
```
**硬阈值**: HTTP 400 且 `error=="invalid_commander_profile"`；不落库（tasks 表无该 title 行）。

---

### Step 2: Work Router 透传三字段 + F1 线默认 hybrid + 默认 profile
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步（第 19 行）+ 假设「F1 判定 = map_scope 含 'F1' 或 journey e6f803f2」（第 39 行）

**可观测行为**: `createRoutedTask` 把 commander_mode/commander/commander_retry_budget 写进 task.payload；map_scope 含 F1（或 journey e6f803f2）且未显式指定 mode 时，payload 落 `commander_mode=hybrid` 且 `commander` = 默认 profile（primary codex/team2/us-mac-m4，fallback claude/account2/us-mac-m4）；显式 kernel-only 关闭；其他线保持 kernel-only。

**验证命令**:
```bash
# 纯决策函数（route 与 routing store 共用，禁 mock）——F1 默认 hybrid + 默认 profile
npx vitest run sprints/08161547-kernel-5a0d640c/tests/commander-routing-default.test.js --reporter=basic
```
**硬阈值**: commander-routing-default.test.js 全绿（含 F1 默认 hybrid、非 F1 保持 kernel-only、显式 kernel-only 覆盖、非法键抛 invalid_commander_profile）。

---

### Step 3: createKernelRun 落 initiative_runs.commander_mode（不再一律 kernel-only）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步末「写入 initiative_runs.commander_mode 与 payload；receipt evidence 记录来源」

**可观测行为**: 真 canary hybrid run 的 initiative_runs 行 `commander_mode='hybrid'`（DB 写路径，接缝边，真 PG 验证）。

**验证命令**:
```bash
RID="${CANARY_RUN_ID:-$(psql "$DB_URL" -tAc "SELECT id FROM initiative_runs WHERE commander_mode='hybrid' AND created_at > NOW()-INTERVAL '3 hours' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')}"
psql "$DB_URL" -tAc "SELECT commander_mode FROM initiative_runs WHERE id='$RID'" | grep -qx hybrid
```
**硬阈值**: 该 canary run 的 `commander_mode='hybrid'`。

---

### Step 4: hybrid run 首跳起手召唤 Commander，directive_accepted 后才派 Planner
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步（第 20 行）「hybrid run 首跳必为 Commander 唤醒；directive 落 orchestrator_decision_log(action=commander.directive_accepted) 后 kernel 才派 Planner」

**可观测行为**: canary 的 orchestrator_decision_log 里第一条 commander 唤醒（Run 启动节点）落在任何 planner 派发之前；连续无进展（同一 gate_verdict 连续 ≥3 跳）触发唤醒；单次 capacity_contended/瞬时 503 不唤醒。

**验证命令**:
```bash
# 唤醒判定纯逻辑（loop→coordinator 接缝的决策核，禁 mock 被改的边）
npx vitest run sprints/08161547-kernel-5a0d640c/tests/commander-wakeup-gate.test.js --reporter=basic
```
**硬阈值**: 首跳 run_created 唤醒、连续 3 跳同 gate_verdict 唤醒 kernel_no_progress、单次 capacity_contended 不唤醒 —— 全绿。

---

### Step 5: FR-2 必唤醒节点全程接线 + commander bundle 读到闸真实结论
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步（第 21 行）「bundle 的 newEvents/activeRisks 必须含闸真实结论：impact_gate reason/retryable/detail、admission signature/admission_reasons、attempt error_code/failure_class」；`[AI_ADDED]` 隔离回归：确保不同 run 的合同/反馈不进本 run bundle（防跨 run 泄漏，FR-1）

**可观测行为**: `deriveCommanderRisks(observed)` 把 impact_gate reason/retryable、admission_reasons、attempt error_code 提炼进 activeRisks；buildCommanderBundle 对跨 run 事件抛 commander_bundle_run_mismatch（run 隔离）。

**验证命令**:
```bash
npx vitest run sprints/08161547-kernel-5a0d640c/tests/commander-risks.test.js --reporter=basic
```
**硬阈值**: activeRisks 含 impact_gate.reason/retryable + admission_reasons + error_code；跨 run 事件被拒 —— 全绿。

---

### Step 6: 真 canary F1 bugfix run 从头跑通，产出 Commander 全程事件（出口）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步 + E2E 验收 5 点（第 22、78-88 行）；假设「canary 采用 f9f943fc 或其 successor 真实 F1 bugfix 任务」（第 40 行）

**可观测行为**: 真实 hybrid F1 bugfix run 落 ≥5 条 action=commander.directive_accepted（分布在 Run 启动/Planner 完成/合同批准/Generator 前/Evaluator 或 Judge 结果）；harness_attempts role='commander' ≥5 条 completed；观测端点返回 status 与单调递增 event_cursor；至少一条异常唤醒 directive action ∈ {retry_attempt,switch_provider,switch_machine,revise_guidance,pause_run,request_human}。

**验证命令**:
```bash
RID="${CANARY_RUN_ID:-$(psql "$DB_URL" -tAc "SELECT id FROM initiative_runs WHERE commander_mode='hybrid' AND created_at > NOW()-INTERVAL '3 hours' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')}"
N=$(psql "$DB_URL" -tAc "SELECT count(*) FROM orchestrator_decision_log WHERE run_id='$RID' AND action='commander.directive_accepted'" | tr -d ' ')
[ "$N" -ge 5 ]
```
**硬阈值**: 该 canary run 的 commander.directive_accepted ≥5 条（详见 ## E2E 验收 段全部 4 点）。

---

## Response Schema（推导来源: PRD 字面 + api_registry 现有 POST /tasks 惯例）

### Endpoint: POST /api/brain/tasks
**Success (HTTP 201)**: 返回创建的 task 行（现有 schema，本单新增 payload 内三字段透传）
```json
{"id": "<uuid>", "status": "queued", "payload": {"commander_mode": "hybrid", "commander": {"primary": {"provider": "codex", "account": "team2", "machine": "us-mac-m4"}, "fallbacks": [{"provider": "claude", "account": "account2", "machine": "us-mac-m4"}]}, "commander_retry_budget": 2}}
```
- `payload.commander_mode` (string, 透传/默认): 来源——PRD 字面（legacy-session|kernel-only|hybrid）
- `payload.commander` (object|缺省, 透传/默认): 来源——PRD 字面（严格按 commander-profile.js schema，键集 = {primary, fallbacks}）
- `payload.commander_retry_budget` (number, 可选透传): 来源——PRD 字面
**禁用字段名**: `commander_profile`（这是入口请求体键；落库为 `payload.commander`，禁止把响应内的落库键写成 commander_profile）、`strict_affinity`（非法 profile 键）
**Error (HTTP 400)**:
```json
{"error": "invalid_commander_profile", "reason_code": "invalid_commander_profile"}
```

> 说明：POST /tasks 成功响应主体是既有 task 行，本单只新增 `payload.*` 三键的透传/默认，未改既有顶层字段。dedup 命中返回 HTTP 200 `{...task, deduplicated:true}`（既有行为，DoD 用 $RANDOM title 规避）。

---

## 已知约束（来自回归测试 + 累积 FR）

- [commander-contract.js] COMMANDER_MODES 冻结为 legacy-session/kernel-only/hybrid；COMMANDER_ACTIONS 含 continue_default/retry_attempt/switch_provider/switch_machine/revise_guidance/pause_run/request_human/abort_run/dispatch_role —— 异常唤醒 directive action 必须取自该冻结集。
- [commander-profile.js] commanderProfileSchema `.strict()`，未知键即抛错；primary 必填、fallbacks ≤3、targets 去重（commander_target_duplicate）。透传校验必须复用该 schema，禁止另写一份放松版。
- [commander-coordinator.js] reconcile 非 hybrid 直接 bypass；有在途 commander attempt 时 wait（幂等，避免重复召唤）—— 本单新增的连续无进展唤醒不得破坏该 in-flight 幂等。
- [commander-wakeup.js] 既有 material 事件集（run.created/phase_changed/terminal/attempt terminal/actor.message）+ commander 自身生命周期事件不触发唤醒（防自激）—— recentGateVerdicts 无进展唤醒是叠加项，不得让 commander 自身事件重新触发唤醒。
- [累积FR] 本 line 暂无 done/working 历史 ability（journey e6f803f2 golden-path 均 planned），无已验收行为可回退；context-manifest: F1 线 e6f803f2 无累积 FR 摘要（planned 态）。
- [initiatives.js:createRelayRun] 既有 createKernelRun 调用已透传 commanderMode（foreground handoff）；本单打通的是 Work Router（POST /tasks）这条缺口路径，不得回退 createRelayRun 现行为。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | POST /tasks 与 Work Router 透传 commander_mode/commander_profile/commander_retry_budget；F1 线未指定时默认 hybrid + 默认 profile；hybrid run 起手召唤 + FR-2 必唤醒节点接线；commander bundle 读闸真实结论；真 canary 全程唤醒 |
| **NFR（做得多好）** | 性能/可靠性/并发 | 单次瞬时 503 / capacity_contended 不唤醒（频控降噪）；commander_retry_budget 入口透传（缺省沿用 Commander 现有预算，无硬编码）；每次唤醒必落 orchestrator_decision_log |
| **Invariant（永不违反）** | 不变量 | Commander 只指挥不执行、不得绕过任何 gate；不改 kernel 执行权；不同 run 合同/反馈不进本 run bundle；其他线保持 kernel-only（零回退）—— 见下方 INV-1..4 |
| **判定点（怎么知道）** | 对模糊现实的判断 | 见判定点登记表 |
| **保质期（何时过期）** | 何时失效 | F1 线默认 hybrid 是配置决策（写 decisions 表），随线策略调整可改；default profile 目标（team2/account2/us-mac-m4）随 Fleet 三机准入单变化需同步更新 |
| **死亡告警（停了谁知道）** | 告警手段 | Commander 不可达回退表现为 run 全程无 commander.directive_accepted；canary 断言（≥5 条）即活性守卫，缺失=DoD FAIL；后续 nightly 可加「近 24h hybrid run 无 directive_accepted」告警（本单只落 canary 断言，不建告警任务） |
| **失败语义（挂了怎么办）** | 放行/拦截/重试 | 见失败语义声明 |
| **效果确认（已发≠已生效）** | 回执方式 | 每次唤醒回执 = orchestrator_decision_log action=commander.directive_accepted + harness_attempts role='commander' completed；观测端点 event_cursor 单调递增 = 确实推进 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ 这条 run 是否属 F1 线（该默认 hybrid） | A. map_scope 含 'F1'; B. journey_id==e6f803f2; C. 两者取并集 | C. 并集（任一命中即 F1） | map_scope 与 journey 双源，单看一个会漏判（有的入口只带 journey_id） | 误判为非 F1 → Commander 不召唤，回到「不可达」；误判为 F1 → 非 F1 线被强开 hybrid（有 kernel-only 显式覆盖兜底） |
| ⚠️ 是否「连续无进展」需异常唤醒 | A. 同一 gate_verdict 连续 ≥3 跳; B. 固定跳数阈值; C. 时间窗 | A. 同一 gate_verdict 连续 ≥3 跳 | PRD FR-2 明列此判据；gate_verdict 相同=闸在原地空转 | 阈值过松 → Commander 噪音；过紧 → 130 跳空转到 deadline（今晚事故根因）重演 |
| 单次故障是否瞬时（不唤醒） | A. capacity_contended/单次 503 视为瞬时; B. 按 failure_class | A. 单次 capacity_contended / 瞬时 503 不唤醒 | PRD 边界情况明列；避免每次容量抖动都召唤 | 误判为瞬时 → 真实 provider 反复失败被压住不召唤（由「连续无进展」与 failover 白名单兜底） |

> `judgment-pending-user:` F1 线默认 hybrid + 默认 profile 目标（team2/account2/us-mac-m4）—— 属配置性决策，PRD 已明列且要求写 decisions 表；本单按 PRD 执行，如主理人对默认 provider/account 有异议在合同评审提出。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| commander_profile 非法 | 400 invalid_commander_profile，不落库 | 是（无副作用） | 调用方改正 profile 重试 |
| hybrid run 但 commander provider 反复失败 | 走既有 failover 白名单换 fallback；耗尽则 request_human（不静默放行） | 是（failover lineage 去重，attempted targets 不重试） | 换 provider/machine；全耗尽 → 人工 |
| commander attempt 在途时又到唤醒点 | reconcile 返回 wait（commander_attempt_inflight），不重复召唤 | 是 | 等待在途完成 |
| 非 F1 线未带 commander_mode | 保持 kernel-only（零回退），不召唤 Commander | 是 | 既有 kernel-only 路径 |

### 输入对抗面（对外暴露 agent 必填）

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| POST /tasks 请求体 commander_profile | 半可信（内部/外部 API 均可调） | commander-profile `.strict()` schema 拒未知键；commander-contract assertNoSecretMaterial 拒 token/secret/api_key 等键 | Commander directive 由 kernel 执行或记 request_human，directive schema 禁 actor 副作用键（action/route/command/cwd/session_id）；Commander 无绕过 gate 能力（INV-1） |

---

## Invariant 覆盖条目（历史铁律逐条映射）

- INV-1 [不绕门禁] Commander 只指挥不执行，无绕过 impact/capacity/CI 的能力 —— 由 commander-directive-executor + directive schema 保证（本单不给 Commander 新增执行权）。见 DoD INV-1。
- INV-2 [不改执行权] kernel 执行权不变，directive 由 kernel 执行或记 request_human —— 本单只接线唤醒点，不改 kernel dispatch 权。见 DoD INV-2。
- INV-3 [run 隔离] 不同 run 的合同/反馈不进本 run bundle —— buildCommanderBundle 对跨 run 事件抛 commander_bundle_run_mismatch。见 DoD INV-3 + commander-risks.test.js。
- INV-4 [nightly-red 原始日志] 连续 ≥3 晚同一 job 红时贴失败 step 最后 20 行原始 stdout —— N/A：本 sprint 不触及 nightly issue 生成模块（无改动）。

---

## 禁 mock 边清单

本单涉及「跨模块数据传递（commander_* 从 route → routing store → createKernelRun 透传）」「状态机/生命周期钩子（loop hybrid 首跳唤醒 + FR-2 节点）」「DB 写路径（initiative_runs.commander_mode）」，以下边禁 mock：

- routes/task-tasks.js ↔ work-routing-store.js（createRoutedTask）：commander_* 透传进 task.payload —— 用真 curl（DoD B-01 route 层 400）+ commander-routing 纯函数真调（DoD B-02）验证，实现测试禁 vi.mock 这条边。
- work-routing-store.js ↔ orchestrator/kernel-run-store.js（createKernelRun）↔ DB 表 initiative_runs：commander_mode 落库 —— 必须真 Postgres 验行落库（canary psql DoD B-05 端到端非 mock + generator 须补一条 `packages/brain/src/__tests__/integration/*.pg.integration.test.js` 走 brain-integration job 真 PG，注册进 vitest.config POSTGRES_INTEGRATION_TESTS）。禁止用 fake pool 顶替。
- orchestrator/loop.js ↔ orchestrator/commander-coordinator.js（reconcile 唤醒）：hybrid 首跳与 FR-2 节点接线 —— 唤醒决策核（commander-wakeup.classifyCommanderWakeup）以真函数直测（DoD B-03，禁 mock）；loop↔coordinator 接缝由真 canary 端到端验证（DoD B-04..B-08）。coordinator 的 store 依赖（commanderStore/eventStore/attemptStore）属更外层边界，允许在 coordinator 单测里以 fake 提供，但被改的唤醒逻辑本身不得 mock。

> 说明（真实链路四硬规则）：规则A 真实调用方 shape —— 本单调用方是 POST /tasks HTTP body（内部/外部 API），认证走服务端 ingress（x-tenant-id header），commander_* 走 body，无「设备 agent header vs body 双路径」分叉，N/A。规则B 第三方真调 —— hybrid canary 会真实调用 codex/claude 作为 Commander LLM（真 key 真请求真响应，directive 落库校验），已由 canary 覆盖。规则C 未覆盖真实链路清单 —— 本合同 canary 全程真跑、无 force_*/mock 顶替，N/A。规则D target_environment —— local_api（curl localhost:5221 + psql），与 orchestrator 真实运行环境匹配。

## 未覆盖真实链路清单

（本合同 canary 全程真跑，无 mock 豁免，N/A）

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 E2E 验证的是**活的 orchestrator 全链路**（真 Brain localhost:5221 + 真 DB $DB_URL + 真 Commander LLM），不是空库 signup 场景 —— 故不套用「空库 migration + signup 自举」模板（该模板针对业务身份类 local_api）：canary 必须打到已运行的 harness 管道。evaluator 侧要求 Brain 与其 DB 已就绪。
> 若 ops 已按 PRD successor 说明启动了 canary，注入 `CANARY_RUN_ID` 直接复用；否则脚本触发一条真实 F1 bugfix hybrid run 并等待其推进过 ≥5 个唤醒点（预算见脚本内 DEADLINE）。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet/evaluator must inject DB_URL pointing at the live Brain database}"
BASE_URL="${BASE_URL:-http://localhost:5221}"

# 0. 解析 canary run：优先复用 ops 已启的 CANARY_RUN_ID，否则触发一条真实 F1 bugfix hybrid run
RID="${CANARY_RUN_ID:-}"
if [ -z "$RID" ]; then
  TITLE="cp-commander-canary-$RANDOM-$(date +%s)"
  BODY=$(curl -sfS -X POST "$BASE_URL/api/brain/tasks" -H 'Content-Type: application/json' -d @- <<JSON
{"title":"$TITLE","description":"F1 commander canary bugfix (real hybrid run)","change_kind":"bugfix","mutation_intent":"write","journey_id":"e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29","payload":{"map_scope":["F1"]}}
JSON
)
  echo "canary task created: $(echo "$BODY" | jq -r '.id') mode=$(echo "$BODY" | jq -r '.payload.commander_mode')"
  # 默认 hybrid 落库确认（F1 线未显式指定 mode）
  echo "$BODY" | jq -e '.payload.commander_mode=="hybrid"' >/dev/null
  echo "$BODY" | jq -e '.payload.commander.primary.provider=="codex" and .payload.commander.primary.account=="team2"' >/dev/null
  TASK_ID=$(echo "$BODY" | jq -r '.id')
  # 等待 Work Router / kernel 为该 task 建 hybrid run
  DEADLINE=$((SECONDS+180))
  until RID=$(psql "$DB_URL" -tAc "SELECT id FROM initiative_runs WHERE current_task_id='$TASK_ID' AND commander_mode='hybrid' ORDER BY created_at DESC LIMIT 1" | tr -d ' '); [ -n "$RID" ]; do
    [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: 180s 内未为 canary task 建 hybrid run"; exit 1; }
    sleep 5
  done
fi
echo "canary run id: $RID"

# 1. initiative_runs.commander_mode='hybrid'（DB 写路径非 mock 证据）
psql "$DB_URL" -tAc "SELECT commander_mode FROM initiative_runs WHERE id='$RID'" | grep -qx hybrid || { echo "FAIL: run commander_mode != hybrid"; exit 1; }

# 2. 等待并断言 ≥5 条 commander.directive_accepted（Run 启动/Planner 完成/合同批准/Generator 前/Evaluator 或 Judge）
DEADLINE=$((SECONDS+2400))
until N=$(psql "$DB_URL" -tAc "SELECT count(*) FROM orchestrator_decision_log WHERE run_id='$RID' AND action='commander.directive_accepted'" | tr -d ' '); [ "${N:-0}" -ge 5 ]; do
  [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: within budget commander.directive_accepted=$N (<5)"; exit 1; }
  sleep 15
done
echo "commander.directive_accepted count=$N"

# 3. harness_attempts role='commander' 至少 5 条 completed
CN=$(psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts WHERE run_id='$RID' AND role='commander' AND status='completed'" | tr -d ' ')
[ "$CN" -ge 5 ] || { echo "FAIL: commander completed attempts=$CN (<5)"; exit 1; }

# 4. 观测端点返回 status 且 event_cursor 单调递增（两次采样后值不减）
C1=$(curl -sfS "$BASE_URL/api/brain/harness-commander/runs/$RID/commander" | jq -r '.event_cursor')
curl -sfS "$BASE_URL/api/brain/harness-commander/runs/$RID/commander" | jq -e '.status!=null' >/dev/null
sleep 3
C2=$(curl -sfS "$BASE_URL/api/brain/harness-commander/runs/$RID/commander" | jq -r '.event_cursor')
[ "$C2" -ge "$C1" ] || { echo "FAIL: event_cursor 回退 $C1 -> $C2"; exit 1; }

# 5. 至少一条异常唤醒 directive action ∈ 非 continue_default 集
AB=$(psql "$DB_URL" -tAc "SELECT count(*) FROM orchestrator_decision_log WHERE run_id='$RID' AND action='commander.directive_accepted' AND detail->'directive'->>'action' IN ('retry_attempt','switch_provider','switch_machine','revise_guidance','pause_run','request_human')" | tr -d ' ')
[ "$AB" -ge 1 ] || { echo "FAIL: 无异常唤醒的非 continue_default directive"; exit 1; }

echo "✅ Commander canary 全程唤醒验证通过 run=$RID accepted=$N commander_completed=$CN anomaly=$AB"
```

**通过标准**: 脚本 exit 0（commander_mode=hybrid + directive_accepted ≥5 + commander completed ≥5 + event_cursor 单调 + 异常唤醒 ≥1）。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: POST /api/brain/tasks 传 `commander_mode:"chaos"`（非法枚举）应 400；`commander_profile` primary 缺 provider 应 400 invalid_commander_profile；fallbacks 传 4 个（超 max 3）应 400。
- 重复提交: 同一 F1 title 连发两次 —— 第二次应 dedup 返回 200 deduplicated，不得重复建 hybrid run（幂等）。
- 中途中断: canary run 进行中，重复调 GET observability endpoint —— event_cursor 只增不减；commander attempt 在途时不得重复召唤（orchestrator_decision_log 无重叠 attempt_id）。
- 边界值: `commander_retry_budget` 传负数 / 超大值（如 999）—— 应被 clamp 到 [0,8]（loop.js 既有 clamp），不得越界召唤。
- 越权面: commander_profile 里塞 `session_id`/`api_key` 键 —— 应被 assertNoSecretMaterial/strict schema 拒（不落库、不进 bundle）。
发现分级: P0/P1（非 F1 线被误开 hybrid / Commander 获得绕 gate 能力 / 跨 run 数据泄漏）→ 阻塞 merge；P2/P3（噪音唤醒、非致命边界）→ 记 findings 不阻塞。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| F1 默认 hybrid + 透传校验 | `tests/commander-routing-default.test.js` | `defaults to hybrid with default profile`、`unknown profile key throws invalid_commander_profile`、`stays kernel-only`、`explicit kernel-only overrides` | resolveCommanderRunConfig 未实现 → import 失败全红 |
| 起手/无进展/瞬时唤醒判定 | `tests/commander-wakeup-gate.test.js` | `wakes when the same gate verdict repeats for 3 consecutive hops`、`does not wake on a single transient capacity_contended`、`wakes on run created` | recentGateVerdicts 未消费 → 连续 3 跳用例红 |
| bundle 闸结论 + run 隔离 | `tests/commander-risks.test.js` | `surfaces impact_gate reason and retryable`、`surfaces admission_reasons and attempt error_code`、`rejects events from a different run` | deriveCommanderRisks 未导出 → 红 |

> BEHAVIOR 覆盖名均为对应 it() 名的字面子串（可 `grep -F` 命中）。
