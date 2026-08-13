# Sprint Contract Draft (Round 1)

Sprint: Harness 入口统一 — Session Controller 所有权不变量 + 四档 change_kind 驱动执行 Profile
Task: 77f19b77-6cc1-4680-9806-e667a72078ef
journey_type: autonomous
target_environment: local_api

gp-anchor: skipped (product-map.json not found)
contract-gate: active (packages/brain/src/lib/contract-gate.js exists, cecelia worktree)
map-radius: [MAP_NOT_CONFIGURED]（task.payload.map_scope/map_repo 均为 null，不回退领域硬编码）

## 锚定父路声明

独立小路（无父路）—— journey e6f803f2 现存 golden-paths 均为 planned 态、run 历史多为 failed/无主孤儿，本 sprint 即修复该启动链缺陷，不覆盖任何已验收父路步骤。

## Response Schema（推导来源: PRD字面）

N/A — 任务无新增 HTTP 响应端点。本 sprint 是纯 Brain 内部编排（启动链收敛 + 状态机分派）+ DB schema 迁移，不新增/不修改对外 REST 响应体。验收 oracle = vitest 集成测试（真 Postgres）+ 真 derive 纯函数 + 真 relay 启动链（只替身最外层 launcher）+ curl 现有 Brain 健康端点（liveness）。Reviewer 第 6 维按「无 HTTP 响应」自动满分维度，[BEHAVIOR] 覆盖以四档 Profile / fail-closed / schema / 生命周期为准。

## 已知约束（来自回归测试 + 累积FR + 铁律）

来源 [回归测试]（existing tests，本 sprint 不得回退）：
- [harness-skill-relay.test.js] → `harness_runtime 缺省继续走旧 controller，保留一键回滚路径`（收敛启动链时**必须保留** harness_runtime 缺省 → 旧路径回滚闸）
- [harness-skill-relay.test.js] → `kernel-v1 启动确定性 orchestrator，不加载或 spawn harness-controller`（Session Controller ≠ 旧 harness-controller skill；仍是确定性编排）
- [harness-skill-relay.test.js] → `kernel launch 失败时事务终结 run/task，不把父任务写回 queued`（launch 失败仍 fail-closed，不复活 queued）
- [harness-skill-relay.test.js] → `P0: heartbeat 覆写 orchestrator_host 后再派发仍命中同任务 kernel run，不 INSERT 第二条`（幂等去重不得破坏）
- [kernel-gear-dispatch.pg.integration.test.js] → `gear 列可 round-trip 且 collectGroundTruth 注入 observed.gear`（gear 语义独立，change_kind 不得与 gear 互推导）
- [kernel-gear-dispatch.pg.integration.test.js] → `hotfix 首角色 generator 无 planner/proposer/reviewer；default 首角色 planner`（gear=hotfix 现有跳阶行为不回退；change_kind Profile 与 gear 分档正交叠加）

来源 [累积FR]：`GET /api/brain/line/e6f803f2.../context-manifest` 返回空 —— 本 line 暂无已验收历史 FR（与 PRD「本 line 暂无已验收历史」一致），无累积约束需承接。context-manifest: available-but-empty。

来源 [铁律 → INV 映射]：见 contract-dod.md `## Invariant 覆盖`（逐条铁律 → INV-N 或 N/A）。

## 禁 mock 边清单

本单涉及**状态机（derive 相位分派）+ 跨模块数据传递（relay→controller→kernel 启动链）+ 生命周期钩子（controller/kernel fatal 恢复）+ DB 写路径（initiative_runs ownership/lease）**四类，禁 mock 被改的边逐条：

- 代码 ↔ `initiative_runs`（controller_session_id / controller_lease_expires_at / change_kind 写读）：真 `pg.Pool` 连真 PG，禁 mock `pool.query` 顶替 INSERT/SELECT/UPDATE。
- `kernel-run-store.createKernelRun` ↔ `initiative_runs`（fail-closed 分支）：真 createKernelRun 真 PG 事务，禁 stub。无 Controller identity 时真的抛错/拒建。
- `harness-skill-relay` Dispatcher→Controller→Kernel 启动链（跨模块 + 生命周期钩子）：真 `spawnSkillRelaySession` / `_spawnKernelRuntime` 代码路径 + 真 `createKernelRun` 真 PG；**只允许替身最外层 launcher**（`deps.launchKernel` / 进程 spawn / worktree ensure / 账号解析 —— 与「先取 ownership 再拉起 Kernel」这条被改的边无关的外层依赖）。
- `orchestrator/derive.derive()` ↔ change_kind Profile 分派（状态机）：真纯函数，禁 mock；observed 手工注入或真 collectGroundTruth 注入。
- `orchestrator/ground-truth.collectGroundTruth(run 行)` ↔ `observed.change_kind` 注入：真查 initiative_runs 行注入（镜像现有 gear 注入路径），禁 mock。

（纯 UI / 纯文档类改动才允许空清单；本单非空。）

## Golden Path

[Dispatcher 请求启动] → [路由层派生 harness_runtime，只能请求 Session Controller] → [Controller 先写 controller_session_id + lease 取 ownership] → [createKernelRun fail-closed 校验 ownership 后建 run] → [Kernel 作为 Controller 受管子进程执行；按 change_kind 分派 Profile] → [Kernel fatal 只结束 Kernel，Controller 存活恢复/结构化终止回传] → [Controller 守到 PR merged + report done 退出]

---

### Step 1: Dispatcher 只能请求启动 Session Controller（harness_runtime 收归路由层派生）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条 + 范围「harness-skill-relay.js 启动链收敛（Dispatcher→Controller→Kernel）」+ 缺陷①（relay 第 359 行提前 return _spawnKernelRuntime 跳过 Controller）

**可观测行为**: Dispatcher 收到 harness initiative（含或不含 payload.harness_runtime=kernel-v1），经 relay 后**不产生 detached 无主 Kernel**；harness_runtime 由路由层派生，调用方 payload 直接指定 kernel-v1 也不得绕过 Controller 取 ownership 这一步。缺省 harness_runtime（未指定）保留走旧 controller 的一键回滚路径（回归约束）。

**验证命令**:
```bash
# 真 relay 启动链集成测试（真 PG + 真 createKernelRun，只替身最外层 launcher）
cd packages/brain && npx vitest run src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js -t 'harness_runtime=kernel-v1 直打不产生无 Controller run' --reporter=basic
# 期望：exit 0；断言 relay 后 initiative_runs 行 controller_session_id 非空 或 Kernel run 不早于 Controller ownership 出现
```

**硬阈值**: 测试 exit 0；`initiative_runs.controller_session_id IS NOT NULL` 且写入时刻 ≤ Kernel run 可执行时刻。

---

### Step 2: Controller 先取 ownership 再拉起 Kernel；createKernelRun 无 Controller identity → fail-closed
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条 + 交付 1（createKernelRun fail-closed）+ 缺陷②（initiative_runs 无 controller_session_id/lease 列）

**可观测行为**: Session Controller 启动后先把 `controller_session_id` + `controller_lease_expires_at` 写入 `initiative_runs` 取得 ownership，再 spawn/resume Kernel。`createKernelRun` 在入参无有效 Controller identity（controllerSessionId 缺失/空）时**拒绝创建并抛错**（fail-closed），不写半态 run。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js -t 'createKernelRun 无 controllerSessionId fail-closed' --reporter=basic
# 期望：exit 0；断言 createKernelRun 抛错、initiative_runs 无新行（真 PG count 校验）
```

**硬阈值**: 无 Controller identity 调用抛错；`SELECT count(*) FROM initiative_runs WHERE current_task_id=$TID`（真 PG）在抛错后不增长。

---

### Step 3: Kernel fatal 只结束 Kernel process，Controller 存活并结构化回传
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条 + 交付 3 + 边界「Controller 取 ownership 后自身 fatal：Kernel 不得成为无主 run（lease 兜底）」

**可观测行为**: Kernel process fatal 时**仅** Kernel process 终结，Controller 存活并执行恢复或结构化终止回传（写 Brain log + `initiative_runs.failure_reason` 结构化值，日志脱敏）。反向：Controller 取 ownership 后自身 fatal，Kernel 不成为无主 run —— lease 过期（`controller_lease_expires_at < NOW()` 且无存活 controller）判定为无主，进恢复流程，不静默放行。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js --reporter=basic
# 期望：exit 0；两个方向断言：Kernel fatal→Controller 存活 failure_reason 结构化；Controller fatal→Kernel 不无主（lease 兜底进恢复）
```

**硬阈值**: Kernel fatal 后 Controller 记录存活、`failure_reason` 非空且为结构化码；Controller fatal 后无 `controller_session_id IS NULL AND phase NOT IN ('done','failed')` 的无主 run 静默存活。

---

### Step 4: derive.js 按 change_kind 分派执行 Profile（四档，全部保留 G→E→J + merge fence）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条 + 交付 4 + 缺陷④（derive 只消费 gear，change_kind 零消费）+ 决策 29ae54ae（正向默认映射，可显式升档，禁反向推导）

**可观测行为**: `derive(observed)` 读 `observed.change_kind`（由 collectGroundTruth 从 initiative_runs 行注入，镜像 gear 注入路径）分派执行 Profile：
- `new_capability` = 全链（planning → GAN → generate → evaluate → judge）+ 人审
- `capability_change` = 轻 Planner + 合同收敛（planning + GAN 保留，收敛兜底存在）
- `bugfix` = 跳 Planner、跳 GAN（初始态直进 generate，语义同 gear=hotfix 的免 planner/GAN，但由 change_kind 驱动，与 gear 正交）
- `parameter_only` = 最轻档（跳 Planner/GAN 直进 generate）
四档**全部保留** Generate→Evaluate→Judge 相位与 merge fence；共用同一条 Controller→Kernel 启动链。change_kind 与 gear 独立计算、独立存储，**禁互推导**；默认映射为正向，显式覆盖只允许升档（如 bugfix→显式 new_capability），禁反向推导降档。

**验证命令**:
```bash
# 纯 derive 状态机（无需 DB，确定性），四档相位分派 + G→E→J 保留断言
cd packages/brain && npx vitest run src/__tests__/kernel-change-kind-profile.test.js --reporter=basic
# 期望：exit 0；bugfix/parameter_only 初始态→phase 'generate'；new_capability→'planning'；capability_change→'planning'/'gan'；四档终局前均经 evaluate+judge
```

**硬阈值**: bugfix、parameter_only 在 `prdExists=false && contract 未批` 初始态 `derive().phase === 'generate'`；new_capability === 'planning'；四档均不跳过 evaluate/judge 与 merge fence（回归：现有 default/hotfix gear 行为逐字节不变）。

---

### Step 5: Controller 守到 PR merged + report done 才退出；无主/异常 Kernel Run fail-closed 进恢复
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 条 + 边界「无主历史 Kernel Run（老数据/迁移前）进入恢复流程，不静默放行」+ Invariant [evaluator时钟]（复用既有 PR 采纳 evaluator validation clock）

**可观测行为**: Controller 生命周期守到 `pr.merged === true` 且 report done 才退出；无主历史 Kernel Run（controller_session_id 为空或 lease 过期）一律 fail-closed 进恢复流程。复用既有 PR 时采纳 evaluator validation clock（不因 Controller 守护改变 validation identity 归属，late-bound）。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js -t '无主历史 Kernel Run fail-closed 进恢复' --reporter=basic
# 期望：exit 0；无 controller_session_id 的历史 run 被判无主 → 恢复流程（不静默 done）
```

**硬阈值**: 无主 run 不进入 `done`；恢复流程被触发（真 PG 状态断言）。

---

## Response identity late-binding 声明

本 sprint 无固化 role attempt/capability 需求。Kernel/Controller 执行身份（HARNESS_ATTEMPT_ID / CAPABILITY_SNAPSHOT_ID 等）由 Runner 在实际执行角色注入，late-bound；测试断言不写 UUID 字面值，controller_session_id 在测试内由真实 spawn/runtime 动态产生。run_id / 仓库 / base SHA 为运行前冻结对象，可固定。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 建立不可绕过启动不变量（任何 Kernel Run 前必先有有效 Controller ownership）；四档 change_kind 真实驱动 Kernel 阶段组合。 |
| **NFR（做得多好）** | 非功能 | 收敛兜底：GAN 轮次无上限但必须有收敛兜底（禁死循环，复用 derive 现有 budgetCap/no-push/no-verdict 兜底）；超时/延迟：待定（PrepPRD 未指定）。 |
| **Invariant（永不违反）** | 不变量 | ① 无 Controller ownership 不得存在活跃 Kernel run；② 四档全保留 G→E→J + merge fence；③ change_kind 与 gear 禁互推导；④ 禁反向推导降档。 |
| **判定点（怎么知道）** | 模糊现实判断 | 见下方判定点登记表。 |
| **保质期（何时过期）** | 失效 | controller lease 用 `controller_lease_expires_at` 时间戳；过期即 ownership 失效 → 无主判定 → 恢复流程。 |
| **死亡告警（停了谁知道）** | 告警 | Kernel/Controller fatal 写 Brain log + 结构化 `failure_reason` 回传 initiative_runs；既有 watchdog 巡检无主/过期 run（日志脱敏适用）。 |
| **失败语义（挂了怎么办）** | 故障 | 见下方失败语义声明（全部 fail-closed 方向）。 |
| **效果确认（已发≠已生效）** | 回执 | 真 PG 查询确认 `controller_session_id` 写入先于 Kernel run 可执行；createKernelRun 拒建时真 PG count 不增长；四档相位真 derive 断言。 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ Kernel Run 是否无主 | A. controller_session_id 为空; B. controller_lease_expires_at < NOW() 且无存活 controller session; C. A OR B | C（A OR B） | 空 = 从未取 ownership；lease 过期 = Controller 已死；两者都必须判无主 | 静默放行无主 run → merged_without_evaluator_gate（不可逆合并，直接面客）|
| ⚠️ Controller 是否 fatal | A. session 心跳超时（lease 未续期）; B. 受管进程退出信号 | A（lease 未续期为权威，B 为辅助信号） | 心跳/lease 是跨节点唯一权威（进程信号跨节点丢，实证 #3848 sprint_dir 跨节点丢） | 误判存活 → Kernel 变无主；误判死亡 → 双重恢复重复派发 |
| Kernel 是否 fatal（区别于 Controller fatal） | A. Kernel 受管进程退出码非 0; B. Kernel run phase 未推进且无在途 attempt | A + B | 只结束 Kernel process 不动 Controller，需精确区分两者 | 误把 Kernel fatal 当 Controller fatal → 连带杀死 Controller，run 无主 |

> ⚠️ 行为「升拍板点主动请教用户」级别（e035dad8 第②条）。PrepPRD 未逐点拍板无主/Controller-fatal 判定阈值，notes 标注待确认：
> judgment-pending-user: Kernel Run 是否无主（lease 过期窗口具体秒数由主理人拍板）
> judgment-pending-user: Controller 是否 fatal（心跳超时阈值由主理人拍板）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| createKernelRun 无 Controller identity | 抛错，拒绝创建，不写半态 run（fail-closed） | 是（幂等键=initiative advisory lock + loadActiveKernelRun 去重） | 调用方修正后带 Controller identity 重试 |
| Controller fatal（lease 过期） | Kernel 不成为无主 run；进恢复流程 | 是（lease 单行 CAS） | 恢复重建 Controller ownership 或结构化终止 |
| Kernel fatal | 只终结 Kernel process，Controller 存活回传结构化 failure_reason | 是（run 单行 finalize 幂等） | Controller 执行恢复或结构化终止回传 |
| 无主历史 Kernel Run（迁移前老数据） | fail-closed 进恢复流程，不静默 done | 是 | 恢复流程接管，禁静默放行 |
| 非法 change_kind | 沿用 change-kind.js normalizeChangeKind throw（现有语义，不改） | N/A | 抛错，不静默降级 |

### 输入对抗面（对外暴露 agent — decisions 27b57469 第9要素）

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| 调用方 task.payload（task_type / orchestrator / harness_runtime / gear / mode） | 低（不可信路由输入） | N/A（非自然语言 agent 输入，无 prompt injection 面） | harness_runtime 收归路由层派生；payload 直指 kernel-v1 不得绕过 Controller 取 ownership（回归测试 POST 直打断言）；越权绕过 = fail-closed |

（本任务非客服/爬虫类自然语言 agent，prompt injection 面 N/A；输入对抗核心是「payload 不可信路由字段不得绕过启动不变量」。）

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 是 Brain 内部编排 + schema 迁移。honest oracle = 真 derive 纯函数状态机（无需 DB，确定性）+ 真 Postgres 集成（真 migrate 含 413 + 真 createKernelRun fail-closed + 真 relay 启动链只替身最外层 launcher + 真 collectGroundTruth 注入）+ curl 现有 Brain 健康端点（liveness）。DB 由集成测试经 `DB_DEFAULTS`（packages/brain/src/db-config.js）自建隔离库并真跑 `src/migrate.js`（镜像 kernel-gear-dispatch.pg.integration.test.js 现有范式），不复制生产数据、不注入业务凭据。

```bash
#!/bin/bash
set -euo pipefail
cd packages/brain

# 0. 现有 Brain liveness（真 curl 现网 Brain，非 mock）
curl -sf -m 10 localhost:5221/api/brain/health | jq -e '.status == "healthy"' || { echo "FAIL: Brain 不健康"; exit 1; }

# 1. 纯 derive 四档 Profile 状态机（确定性，无需 DB）—— 四档相位分派 + G→E→J 保留
npx vitest run src/__tests__/kernel-change-kind-profile.test.js --reporter=basic || { echo "FAIL: 四档 Profile 状态机"; exit 1; }

# 2. 真 Postgres 集成：migration 413 列 + createKernelRun fail-closed + 启动链 ownership
npx vitest run src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js --reporter=basic || { echo "FAIL: Controller ownership / fail-closed / migration 413"; exit 1; }

# 3. 真 Postgres 集成：Controller/Kernel 生命周期（fatal 隔离 + 无主 fail-closed 恢复）
npx vitest run src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js --reporter=basic || { echo "FAIL: Controller/Kernel 生命周期"; exit 1; }

echo "✅ Golden Path 全程验证通过（四档 Profile + ownership fail-closed + 生命周期隔离 + migration 413）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: createKernelRun 传 controllerSessionId='' 空串 / 传非 UUID 字符串 → 必须 fail-closed 抛错，不静默建 run
- 重复提交: 同 initiative 并发两次 Controller spawn → advisory lock + loadActiveKernelRun 去重，不产生第二条 run（回归 P0）
- 中途中断: Controller 取 ownership 后、Kernel launch 前进程被杀 → lease 过期后判无主进恢复，Kernel 不裸奔
- 边界值: lease 恰好过期（controller_lease_expires_at == NOW()）/ change_kind 为旧值（fix/small/thicken）经 normalizeChangeKind 归一后的 Profile 落点
发现分级: P0/P1（无主 run 静默合并 / ownership 绕过）→ 阻塞 merge；P2/P3（恢复流程日志噪声等）→ 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 四档 change_kind Profile 分派 | `packages/brain/src/__tests__/kernel-change-kind-profile.test.js` | bugfix 跳 planning 直进 generate；parameter_only 跳 planning；new_capability 全链 planning；四档均保留 evaluate+judge | derive 现不消费 change_kind → bugfix/parameter_only 现返回 planning（已实证 RED，见 tests/red-evidence.md） |
| Controller ownership + fail-closed + migration 413 | `packages/brain/src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js` | createKernelRun 无 controllerSessionId fail-closed；harness_runtime=kernel-v1 直打不产生无 Controller run；initiative_runs 有 controller_session_id/controller_lease_expires_at 列 | 413 未建、createKernelRun 无 ownership 校验 → 列不存在 + 无主 run 可建（RED） |
| Controller/Kernel 生命周期隔离 | `packages/brain/src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js` | Kernel fatal→Controller 存活；Controller fatal→Kernel 不无主；无主历史 run fail-closed 进恢复 | Kernel detached 现无主，fatal 后 ownership 消失（RED） |
