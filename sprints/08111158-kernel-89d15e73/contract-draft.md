# Sprint Contract Draft (Round 1)

**Sprint**: sprints/08111158-kernel-89d15e73（task 89d15e73）
**标题**: coding 路由收归 kernel —— 改代码任务派发时打标 code_change + gear 并强制进 harness（决策 bf361265）
**journey_type**: autonomous
**target_environment**: local_api（本 sprint 以 brain-unit vitest 单测验收；runtime_resources.postgres=false，测试 `vi.mock('../db.js')`，不依赖真库）

> gp-anchor: skipped (product-map.json not found)
> contract-gate: cecelia worktree，packages/brain/src/lib/contract-gate.js 存在 → 代码层 Contract Gate 生效（本合同断言均为 vitest exit-code oracle）。

## 锚定父路声明

独立小路（无父路）—— 本 sprint 是 dispatcher/task-router 派发层的改代码识别 + kernel 分流收归，无已有 Golden Path 父路。

---

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 是 Brain 内部派发层改动（`dispatcher.js` / `task-router.js`），不新增/改动任何 HTTP 端点，无对外 response schema。可观测产出为「派发时任务 payload 打标 + spawn 通道选择」，由 brain-unit vitest 断言。

---

## Golden Path

[Brain tick 选中改代码任务] → [派发层 classifyCodeChange 识别 + deriveGear 打标] → [resolveDispatchChannel 判 kernel → reroute task_type=harness_initiative] → [triggerCeceliaRun 走 harness full-graph（kernel run），legacy dev 直通分支未走]

### Step 1: 派发层识别「改代码」任务（纯分类）
**来源**: `[FROM_PRD]` — PRD 第 20-21 行 / 「要做什么 2. 打标机制…识别规则先用 task_type 白名单（dev/bugfix 类）」

**可观测行为**: `task-router.classifyCodeChange(task)` 对 `task_type ∈ {dev, codex_dev}`（`CODE_CHANGE_TASK_TYPES` 白名单）或 `payload.code_change===true`（显式扩展点）返回 `{ code_change: true }`；对 research/arch_review/talk/data 等返回 `{ code_change: false }`。`resolveDispatchChannel(task)` 据此返回 `'kernel'` / `'legacy'`。

**验证命令**:
```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" \
  npx vitest run src/__tests__/coding-route-kernel.test.js -t "判定改代码" --reporter=dot
# 期望：exit 0（dev / codex_dev → code_change=true, channel=kernel）
```
**硬阈值**: dev/codex_dev → code_change=true & channel=kernel；非白名单且无显式标 → false & legacy。对应命令即上。

---

### Step 2: 改代码任务打标 code_change + gear 并 reroute 到 kernel 通道
**来源**: `[FROM_PRD]` — PRD 第 21 行「落 payload 标记 code_change=true + gear … 路由到 kernel harness 通道（走 harness_initiative full-graph spawn），不再调用 triggerCeceliaRun legacy spawn」+ 假设行 40（复用现有 harness_initiative full-graph）

**可观测行为**: dispatcher 在 spawn 前，对 `resolveDispatchChannel===kernel` 的任务：
1. `gear = deriveGear(task)`（复用 `harness-skill-relay.js` 既有纯函数，枚举 `['default','hotfix','segmented']`，缺省 `default`）；
2. payload 合并打标 `{ code_change:true, gear, origin_task_type:<原task_type> }`（**merge，不覆盖既有字段**，如 `orchestrator`/`executor`）；
3. reroute `task_type='harness_initiative'`，使 `executor.triggerCeceliaRun` 的 harness 分支（executor.js:3417）走 `runHarnessInitiativeRouter` → 写 `initiative_runs`（kernel 裁决线）。

传给 spawn 层（`triggerCeceliaRun`）的 task 已是 reroute + 打标后的对象；dev legacy 直通分支不再被走。

**来源**: gear「大功能=segmented / bug·小改动=hotfix 或 default」的体量分档为 `[AI_ADDED]` 扩展点——理由：SSOT（`harness-skill-relay.GEAR_VALUES`）无 PRD 所写的 `deep` 档，第一版按 `deriveGear` 缺省 `default`（尊重 `payload.gear` 显式值），体量启发式留后续，不在本合同强约束具体档位映射。

**验证命令**:
```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" \
  npx vitest run src/__tests__/coding-route-kernel.test.js -t "dev 改代码任务派发" --reporter=dot
# 期望：exit 0 —— triggerCeceliaRun 收到 task_type='harness_initiative' & payload.code_change===true
#       & payload.gear ∈ 枚举 & payload.origin_task_type==='dev'
```
**硬阈值**: 传给 spawn 层的 `task_type==='harness_initiative'` 且 `payload.code_change===true` 且 `payload.gear ∈ {default,hotfix,segmented}` 且 `payload.origin_task_type==='dev'`。命令同上。

---

### Step 3: 非改代码任务行为不变（Invariant）
**来源**: `[FROM_PRD]` — PRD 第 24 行「task_type 非改代码类（research/arch_review/talk/data 等）派发行为不变」+ Invariant [非改代码不受影响]

**可观测行为**: research/arch_review 等任务派发后，传给 `triggerCeceliaRun` 的 `task_type` 保持原值，payload 无 `code_change` 标。

**验证命令**:
```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" \
  npx vitest run src/__tests__/coding-route-kernel.test.js -t "非改代码 research 任务派发" --reporter=dot
# 期望：exit 0 —— triggerCeceliaRun 收到 task_type='research' & payload.code_change===undefined
```
**硬阈值**: `task_type==='research'` 不变 & `payload.code_change===undefined`。命令同上。

---

### Step 4: 重复派发打标幂等
**来源**: `[FROM_PRD]` — PRD 第 30 行「同一改代码任务被重复派发时打标幂等，不产生重复 kernel run」

**可观测行为**: 已在 kernel 通道（`task_type==='harness_initiative'`）且已标 `code_change===true` 的任务再次派发时，不二次 reroute、不覆盖 `origin_task_type`。

**验证命令**:
```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" \
  npx vitest run src/__tests__/coding-route-kernel.test.js -t "幂等" --reporter=dot
# 期望：exit 0 —— origin_task_type 仍为 'dev'（未被二次覆盖成 harness_initiative），单次 spawn
```
**硬阈值**: 再派发后 `payload.origin_task_type==='dev'` 且 `triggerCeceliaRun` 调用 1 次。命令同上。

---

### Step 5: 既有 dev 派发链回归不破
**来源**: `[FROM_PRD]` — PRD「回归：现有 orchestrator/dispatcher 测试全绿」

**可观测行为**: `dispatcher-dev-no-langgraph.test.js` 6 例仍全绿（dev 仍经 `triggerCeceliaRun` 单次调用、同 id、`runtime!='v2'`、非白名单 code_review 行为不变、skill-relay 降级 executor=codex 仍生效）。

**验证命令**:
```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" \
  npx vitest run src/__tests__/dispatcher-dev-no-langgraph.test.js --reporter=dot
# 期望：exit 0，6 passed
```
**硬阈值**: exit 0，6 passed。命令同上。

---

## 已知约束（来自回归测试）

- [dispatcher-dev-no-langgraph.test.js] → `dev task 派发 → triggerCeceliaRun 被调`（reroute 后仍须 `triggerCeceliaRun` 单次调用且 `calls[0][0].id===task.id`——本合同 reroute 只改写 task_type/payload、不改 id、不改调用次数，故此回归保持绿）
- [dispatcher-dev-no-langgraph.test.js] → `non-dev task_type 也走 triggerCeceliaRun（行为不变）`（code_review 非白名单，不受收归影响）
- [dispatcher-dev-no-langgraph.test.js] → `budget_state=tight… payload.executor 必须是 codex`（skill-relay 降级——reroute 必须 merge 而非覆盖 payload，保住 executor 字段）
- [dispatcher-initiative-lock.test.js] → initiative lock 仅对 harness 类型生效（reroute 发生在派发链末端 spawn 前，不改前段 lock 判定语义）
- `[累积FR]`：本 line 暂无历史（PRD 第 67 行）。
- context-manifest：unavailable（runtime_resources.postgres=false，无本地 Brain HTTP，端点不可达；不阻塞，按 PRD 累积 FR 段「本 line 暂无历史」处理）。

---

## 禁 mock 边清单

本单改动涉及 **调度/派发决策** 与 **跨模块数据传递**（dispatcher ↔ task-router），故 failing test 不得 mock 被改的那条边：

- **dispatcher ↔ task-router（本单新增改代码识别/channel 决策）** —— 测试真调 `task-router.classifyCodeChange` / `resolveDispatchChannel` / `CODE_CHANGE_TASK_TYPES`（真实模块，**禁** `vi.mock('../task-router.js')`）。
- **dispatcher 派发决策分支（本单改：code_change 任务 spawn 改走 kernel + payload 打标）** —— 测试真跑 `dispatchNextTask` 分支，断言传给 spawn 层的入参已 reroute + 打标；**禁** mock 决策代码本身。
- **dispatcher → deriveGear（gear 值来源）** —— 复用 `harness-skill-relay.deriveGear` 真实纯函数，**禁** mock 其返回值。

允许 mock 的**更外层无关依赖**（本单未改其行为）：`db.js` pool（任务 claim/update 管道；runtime_resources.postgres=false，无真库，与既有 dispatcher 单测同款 `vi.mock('../db.js')`）、`slot-allocator`/`quota-*`/`circuit-breaker` 等 gating、`triggerCeceliaRun`/`runHarnessInitiativeRouter`（真实 fork Docker 容器 + 跑 full-graph 的外部边界，仅 spy 断言入参，不在单测内真起容器）。

**DB 写路径说明**：本单**未在** dispatcher/task-router 内新增 DB 写路径——`initiative_runs` 首行由 out-of-scope 的 `runHarnessInitiativeRouter` 内部写。故本合同不要求真 Postgres，与 runtime_resources.postgres=false 一致；`initiative_runs` 真行属接缝（见接缝清单），logic-done-pending。

---

## 接缝清单（接缝 vs 逻辑）

| # | 断言点 | 类型 | 验证位置 | done 判定 |
|---|--------|------|----------|-----------|
| 1 | classifyCodeChange / resolveDispatchChannel 纯分类 | 逻辑 | brain-unit vitest（真实 task-router） | CI 绿 = done |
| 2 | dispatcher reroute + 打标 + 幂等决策 | 逻辑 | brain-unit vitest（真跑 dispatchNextTask，db mock） | CI 绿 = done |
| 3 | 改代码任务真的在 `initiative_runs` 落一行 kernel run（进 evaluator+judge 裁决线） | **接缝** | 需真 Postgres + 真 Docker full-graph（runHarnessInitiativeRouter，out-of-scope；runtime_resources.postgres=false 本 sprint 无法真跑） | **logic-done-pending**：单测层已验「reroute 到 harness_initiative + 打标」这一必要且充分的派发决策；真 initiative_runs 行由 merge 后 kernel 常规 run / brain-integration PG job 观测 |

**写死环境假设值**：无（gear 取 `deriveGear` 缺省，不硬编码档位；白名单为 task_type 字面枚举，非环境值）。

---

## 未覆盖真实链路清单

- **真实 kernel Docker full-graph spawn + `initiative_runs` 落行**｜本 sprint 只收归 Brain 派发层决策 + 打标，真实 spawn 走 fork Docker + 真 Postgres，brain-unit（postgres:false）不真起｜真验证补位计划：merge 后由 kernel 对一条真实 dev 任务的常规 run 观测 `initiative_runs`，或 brain-integration（真 PG）job 覆盖；controller 请把本条呈现进 PR 描述。
- 本合同 DoD 无 `force_*`/stub/假数据字段；`triggerCeceliaRun` 为 Docker-spawn 外部边界，按上表接缝#3 登记，非静默 mock。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 派发层识别改代码任务（task_type 白名单 dev/codex_dev + payload.code_change 扩展点），打标 `code_change=true`+`gear`，reroute 到 kernel harness 通道（task_type=harness_initiative），改代码任务对 legacy dev 直通关闭 |
| **NFR（做得多好）** | 性能/可靠性 | 打标幂等（同任务不产生重复 kernel run）；派发决策为同步纯判定，无新增 I/O；PrepPRD 未指定超时/延迟阈值 → 待定 |
| **Invariant（永不违反）** | 不变量 | ①非改代码 task_type 派发行为不变；②不改 merge 裁决闸；③不改 codex/grok provider 语义（reroute 只 merge payload、保留 provider/executor/orchestrator 字段） |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见判定点登记表（本任务改代码判定基于 task_type 字面白名单 + 显式标记，非对外部真实状态的推断） |
| **保质期（何时过期）** | 失效/退役 | 白名单为常量，随 task_type 体系演进维护；`code_change` 显式标记为长期扩展点，无固定过期 |
| **死亡告警（停了谁知道）** | 告警 | 若收归回退（改代码任务又走 legacy），`dispatcher-dev-no-langgraph` + 本 sprint 回归测试会红，CI 拦截；运行期由 kernel `initiative_runs`/harness-watchdog 观测改代码任务是否进裁决线 |
| **失败语义（挂了怎么办）** | 故障策略 | `deriveGear` 遇非法 gear 抛错 → executor 层既有 `invalid_gear` terminal failed 兜底（不放行）；classifyCodeChange 为纯判定，不抛；reroute 幂等可重入 |
| **效果确认（已发≠已生效）** | 回执 | 派发后传给 spawn 层的 task 已 reroute+打标（单测断言）；真 `initiative_runs` 落行为接缝，见接缝清单#3（logic-done-pending） |

### 判定点登记表

（本任务无接缝判定点，N/A —— 改代码判定基于 task_type 字面白名单 + 显式 `payload.code_change` 标记，不推断任何外部真实世界状态。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `deriveGear` 遇非法 `payload.gear` | 抛 `invalid_gear`，executor 层标 terminal failed（fail-closed，不派 kernel run） | 是（改 payload.gear 为合法值后重派） | 无（非法配置不放行） |
| classifyCodeChange/resolveDispatchChannel | 纯判定，不抛；未命中白名单 → legacy（保守回退，行为不变） | 是（无副作用） | 回落 legacy 通道 |
| 重复派发同一 code_change 任务 | 幂等 no-op（不二次 reroute/打标） | 是 | N/A |

### 输入对抗面

N/A —— 本 sprint 是 Brain 内部派发层改动，输入来源为 Brain 自身 tick 选中的任务，非对外暴露 agent / 外部可写入接口。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `payload.gear` 传枚举外非法值（如 `"deep"`/`"xxx"`）派发 → 预期走 executor `invalid_gear` terminal，不静默当 default
- 重复提交: 同一 dev 任务连续两次进 dispatchNextTask（幂等：不产生二次 reroute、payload.origin_task_type 不被覆盖）
- 中途中断: 已 reroute 为 harness_initiative 的任务再次被 select（不应再叠加 code_change 标 / 不改 id）
- 边界值: task_type 大小写/前后空格（如 `'DEV'`/`' dev '`）—— 白名单精确匹配，非模糊，不应误判为改代码
- 混合: dev + `payload.orchestrator='skill-relay'` + budget tight —— reroute 必须 merge 保住 `executor=codex`，不覆盖 orchestrator
发现分级: P0/P1（改代码任务漏进 kernel / 非改代码被误收归 / provider·executor 字段被覆盖）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## E2E 验收（final-e2e 跑 — target_environment=local_api，brain-unit vitest）

**journey_type**: autonomous
**target_environment**: local_api

> runtime_resources.postgres=false 且本 sprint 无 live Brain：验收为 brain-unit vitest 单测（`vi.mock('../db.js')` 纯单元，无真 PG 依赖，无需 DB_URL 引导）。evaluator 直接跑下方脚本；exit 0 = Golden Path 全过。

```bash
#!/bin/bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT/packages/brain"
export NODE_OPTIONS="--max-old-space-size=3072"

# 1. Golden Path 单测：改代码识别 + kernel 分流 + 打标 + 幂等（真实 task-router + 真跑 dispatcher 分支）
npx vitest run src/__tests__/coding-route-kernel.test.js --reporter=verbose

# 2. 回归：既有 dev 派发链契约不破（triggerCeceliaRun 单次调用同 id、非 dev 行为不变、skill-relay 降级）
npx vitest run src/__tests__/dispatcher-dev-no-langgraph.test.js --reporter=verbose

echo "OK: coding 路由收归 kernel Golden Path 单测全过"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 分类 + 分流 + 打标 + 幂等（全量，brain-unit 通道） | `packages/brain/src/__tests__/coding-route-kernel.test.js`（权威） | `判定改代码`、`非改代码 task_type=research`、`dev 改代码任务派发`、`非改代码 research 任务派发`、`幂等` | Round 1 实跑：5 failed / 2 passed（`classifyCodeChange is not a function` ×4 + `expected 'dev' to be 'harness_initiative'` ×1；两条「行为不变」guard 现绿） |
| 纯分类（Sprint Tests 通道） | `sprints/08111158-kernel-89d15e73/tests/coding-route-kernel.test.js`（零 mock，root config 收录） | `判定改代码且 channel=kernel`、`非改代码 task_type=research`、`显式 payload.code_change` | Round 1 实跑（root config）：4 failed（`classifyCodeChange is not a function`） |

> **双通道落位说明（两个 vitest 配置为 SSOT）**：
> - `packages/brain/vitest.config.js`（brain-unit）的 include **不含 `sprints/**`**（实测 `npx vitest run sprints/.../x.test.js` 报 `No test files found`）→ dispatcher 重 mock 集成用例必须落 `packages/brain/src/__tests__/`（`src/**/*.test.js` 收录，非 exclude，纯 `vi.mock('../db.js')` 单元）。
> - 根 `vitest.config.js`（harness「Sprint Tests」通道）**include `sprints/**`** → 故 `sprints/.../tests/` 内放**零 mock 纯分类**用例（import `../../../packages/brain/src/task-router.js`，root config 下可直接跑，实测 red），不放带相对 mock 路径的 dispatcher 集成用例（会在 Sprint Tests 通道 import 失败）。
>
> **BEHAVIOR 覆盖名 = it() 名字面子串**：上表覆盖名均可 `grep -F '<名>' <对应 Test File>` 命中。
