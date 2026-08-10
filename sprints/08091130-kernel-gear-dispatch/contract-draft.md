# Sprint Contract Draft (Round 1) — kernel 真读 gear：三档在 orchestrator 状态机内分流

## 锚定父路声明

覆盖父路 e6f803f2 工厂·F1 开发闭环·步1「接单进车间即分档」(3bf6c116) 第 3-4 步（kernel derive 分档 + 可观测角色分布出口）。

## 交付状态提示（proposer 复核确认）

- PRD `## 交付状态提示` 与 `[ASSUMPTION]` 均声明：本 sprint 与已合并 **#4747（commit 9cc96044a, sprint 08091640）** 同名交付，实现已在基线 sha `42ee0a70f` 上落地。proposer 已 `grep` 复核：
  - `packages/brain/src/orchestrator/derive.js:650-665` 已含 0.6 gear 分档（invalid_gear fail-closed + hotfix 跳相位）。
  - `packages/brain/src/orchestrator/kernel-run-store.js:432,450` 已写 `gear` 列；`migrations/396_initiative_runs_gear.sql` 已加列。
  - `packages/brain/src/orchestrator/ground-truth.js:625` 已每跳注入 `run.gear ?? 'default'`。
  - `packages/brain/src/orchestrator/__tests__/derive.test.js:1306-1368` 已含 gear 三档单测；`packages/brain/src/__tests__/integration/kernel-gear-dispatch.pg.integration.test.js` 已含真 PG 角色分布集成测试。
- **故本合同是「真跑验收断言确认三档行为」路径**（PRD 明示），非从零实现。TDD 测试预期**绿**（回归锚点），不是 Red。

## ⚠️ 列名核对更正（Invariant [列名核对] 触发 — proposer 必读）

PRD/thin_prd 反复写的表名 **`initiative_attempts` 不存在**。proposer 已 psql/grep 核对真实 schema：
- 角色记录真实表 = **`harness_attempts`**（`migrations/357_harness_provider_attempts.sql:8-10`，`role TEXT NOT NULL CHECK (role IN ('planner','proposer','reviewer','generator','evaluator','judge','reporter'))`）。
- 与 `initiative_runs` 经 **`harness_attempts.run_id = initiative_runs.id`** join。
- 档位列 = `initiative_runs.gear`（migration 396，可空，NULL = default 语义）。

**本合同所有验收断言一律使用 `harness_attempts` + `initiative_runs.gear`**，不使用 PRD 里的错误表名 `initiative_attempts`。

---

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应（纯 kernel 状态机分叉 + `initiative_runs.gear` DB 列 + `ground-truth` 注入，无对外 endpoint 新增/变更）。Reviewer 第 6 维 verification_oracle_completeness 按 schema 段 N/A 处理。

---

## 真实调用方请求 shape

kernel 的 gear「调用方」是 **Brain 内部 executor 派发路径**，非外部设备/agent：
- 字段逐字：`task.payload.gear`（`string`，`∈ {default, hotfix, segmented}` 或非法值 / 缺省 / NULL）。
- 消费点 1（点火前硬校验）：`executor.js:3090-3101` 调 `deriveGear(task)`（`harness-skill-relay.js:76,84` SSOT，`GEAR_VALUES=['default','hotfix','segmented']`，非法 throw → `markInitiativeTerminalFailed(..., 'invalid_gear')`）。
- 消费点 2（落库）：`kernel-run-store.js:450` `INSERT INTO initiative_runs (..., gear) VALUES (..., input.gear ?? null)`。
- 消费点 3（每跳注入）：`ground-truth.js:625` `gear: run.gear ?? 'default'` → `observed.gear` → `derive.js:659` `const gear = observed.gear ?? 'default'`。

**死规则**：合同断言字段名一律用字面 `gear` / `initiative_runs.gear` / `observed.gear`，禁改名（如 `mode`/`tier`）。

---

## 禁 mock 边清单

本单触及「状态机分叉 + 跨模块数据传递 + DB 写路径」，以下边禁 mock（真 PG、真相邻模块）：

- **代码 ↔ `initiative_runs.gear` 列**（本单写/读 gear 列，测试必须真 Postgres 验 gear 落库与读回，禁 mock `pool.query` 顶替 INSERT/SELECT）。
- **`collectGroundTruth(run 行)` ↔ `derive.observed.gear`**（本单每跳现查 run 行注入，测试必须真 `collectGroundTruth`，禁替身 run 行）。
- **`derive` 首跳 action → `harness_attempts.role`**（本单分叉决定首角色，测试必须真 `derive` + 真 `attemptStore` 写 `harness_attempts`，仅允许替身**最外层** dispatch/launcher exec）。
- **`derive.js` 纯函数本体**：无被改的外部边可 mock，单测直调 `derive(observed)` 无 mock/无替身。

允许 mock 的仅「更外层无关依赖」= agent launcher / dispatch 的进程执行（gh/git/docker exec 空替身），见「未覆盖真实链路清单」登记。

---

## 未覆盖真实链路清单

- **generator/planner agent session 真实执行到产出 PR** — 替身（最外层 launcher/dispatch exec 空回）｜原因：本 sprint 验收点只要求「首跳角色分布」（`harness_attempts.role` 行在 derive 派发即落库，无需 agent 真跑完），且真跑 agent 属独立 evaluate/judge 相位职责，非本状态机分叉范畴｜真验证补位：generator 相位真跑由下游 harness generate→evaluate→judge 链覆盖，非本合同。
- **真 PG 集成测试的运行环境** — 需 brain-integration 级 Postgres（`CREATE DATABASE` 权限，测试自举隔离空库并真跑 migrate 至 396）｜若 evaluator 的 local_api attempt 无此权限则该条 `logic-done-pending`，由 `brain-integration` CI job（`vitest.integration.config.js`）覆盖｜见 E2E 脚本内 `DB_HOST` 前置断言。

（无 `force_*`/假数据/stub 业务响应；唯一替身是上面登记的最外层 launcher exec。）

---

## local_api 空库与业务登录自举（本 sprint 适配声明）

- 本 sprint 是 **cecelia 自身 kernel 内部状态机**，**无业务 signup/login/tenant/cookie**（调用方是 Brain 内部 executor，非外部用户）→ 业务登录自举 = **N/A**。
- 空库自举由集成测试 `kernel-gear-dispatch.pg.integration.test.js` 内部完成：admin pool 在 `postgres` 库 `CREATE DATABASE` 隔离空库 → `execFileSync(migrate.js)` 真跑仓库迁移至 396（gear 列）→ 真 `createKernelRun`/`collectGroundTruth`/`derive`/`attemptStore`。不复制生产数据、不预注入业务凭据。
- 不声明必填 `AUTH_COOKIE*`/`TENANT_ID*`；仅声明 Fleet 注入的 Postgres 连接 env（`DB_HOST/DB_PORT/DB_USER/DB_PASSWORD`，需 `CREATE DATABASE` 权限）。

## Kernel validation identity（late-bind 声明）

本合同不写任何 attempt/account/snapshot UUID 字面值。验收全部为纯函数单测 + 真 PG 集成，不依赖运行时角色身份注入；无 `HARNESS_*`/`CAPABILITY_SNAPSHOT_ID` 硬编码需求。

## Contract Gate

contract-gate: skipped？→ 复核：`packages/brain/src/lib/contract-gate.js` 存在（cecelia worktree），故 Contract Gate 生效，本合同断言按其惯用法编写（curl 无本 sprint 场景；psql 计数带时间窗；vitest 真跑捕获退出码）。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## 已知约束（来自回归测试 + 累积 FR + 铁律）

- [回归测试] `packages/brain/src/orchestrator/__tests__/derive.test.js` → 100+ 存量 derive 用例不传 gear，必须保持 spawn:planner/generator 现行为（零回归红线）。
- [回归测试] `derive.test.js:1346-1362` → gear=default/undefined/segmented 初始态 → spawn:planner；gear=hotfix → spawn:generator；gear=turbo → mark_failed/invalid_gear。
- [累积FR] （本 line e6f803f2 golden-paths 过滤 done/working = 0 条，暂无已验收历史）— context-manifest 未额外拉取（postgres:false，端点不可达，记 `context-manifest: unavailable`）。
- [铁律 INV-零回归] gear=default（含缺省/NULL）与现行 derive 逐字节等价，100+ 存量用例不得转红。
- [铁律 INV-fail-closed] 非法 gear kernel 侧 terminal failed（reason=invalid_gear），禁静默降级、禁进任何相位。
- [铁律 INV-列名核对] 涉表字段合同/测试前先核对真实列名 → 已核对：真实表 `harness_attempts`（非 `initiative_attempts`），列 `initiative_runs.gear`。
- [铁律 INV-实跑验证] 验证命令必须实跑确认 exit code 语义 → E2E 脚本对 vitest「No test files found」假绿陷阱加守卫。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | kernel derive() 真读 `observed.gear`（源自 `initiative_runs.gear` ← `payload.gear`），三档分叉：hotfix 跳 planning/gan 直进 generate；default/segmented/缺省 落现行 planning 门；非法 gear fail-closed | 已实现（#4747），本 sprint 复核 |
| **NFR（做得多好）** | derive 是纯函数，单跳 O(1)；无新增延迟；gear 列可空零回填（存量 192 run 零改） | PrepPRD 未指定阈值；零回归为硬约束 |
| **Invariant（永不违反）** | ①default/缺省/NULL 逐字节等价现行；②非法 gear terminal failed 不进相位；③断言用真实表名 harness_attempts | 见「已知约束」铁律段 |
| **判定点（怎么知道）** | 见下方登记表 | 见登记表 |
| **保质期（何时过期）** | GEAR_VALUES 枚举跟随 harness 能力演进；两端（relay SSOT / derive 副本）由回归守卫保鲜 | 无固定过期；枚举变更时同步两端 |
| **死亡告警（停了谁知道）** | gear 分档失效（回退裸 default）→ 回归单测 `derive.test.js` gear 用例转红即 CI 拦截；真 PG 集成角色分布断言转红即拦截 | CI（brain-ci + brain-integration）即告警 |
| **失败语义（挂了怎么办）** | 见下方失败语义声明 | 见声明 |
| **效果确认（已发≠已生效）** | 分档「生效」= `harness_attempts.role` 分布反映该档相位链（hotfix 无 planner/proposer/reviewer 且有 generator；default 有 planner）；带 10 分钟时间窗防历史冒充 | psql 计数 + 时间窗回执 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳定 | 静默丢消息 |

（本任务无接缝判定点，N/A — gear 值来自 `payload.gear` 确定性枚举，非「对模糊外部现实的推断」；非法值判定是纯白名单校验 `GEAR_VALUES.includes(gear)`，确定性。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 非法 gear 值 | derive 返回 `{phase:'failed', action:'mark_failed', reason:'invalid_gear'}`；executor 点火前 `markInitiativeTerminalFailed` | 是（同 initiative 重派同值仍 terminal failed，确定性） | 无降级——fail-closed，禁静默转 default |
| gear 列 NULL/缺省 | `ground-truth` 降级 `observed.gear='default'`，走现行 planning 门 | 是 | 等价 default（零回归红线） |
| `initiative_runs.gear` 读取异常 | 走通用 collectGroundTruth 异常路径（非本 sprint 改动） | N/A | 现行为不变 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| `task.payload.gear` | 内部 executor 派发（非对外暴露 agent） | N/A（非自然语言输入，纯枚举字段） | 非法值双闸 fail-closed（relay deriveGear throw + derive mark_failed），不静默降级 |

（本任务非对外暴露 agent，输入对抗面主体 N/A；仅登记非法 gear 的 fail-closed 双闸。）

---

## Golden Path

[Brain 派发带 gear 的 harness_initiative] → [kernel 读 gear 落 initiative_runs.gear] → [ground-truth 每跳注入 observed.gear] → [derive 按档分叉] → [harness_attempts 角色分布反映该档相位链]

### Step 1: Brain 派发 harness_initiative，payload.gear ∈ {default, hotfix, segmented} 或非法值

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条 / 步骤 1「入口」。

**可观测行为**: 派发的 task.payload 含 `gear` 字段（字面），executor 点火前 `deriveGear(task)` 校验：合法透传、非法 throw → terminal failed（invalid_gear）。

**验证命令**:
```bash
# deriveGear SSOT 白名单校验（纯函数真调）
node --input-type=module -e 'import {deriveGear,GEAR_VALUES} from "./packages/brain/src/harness-skill-relay.js"; console.log(JSON.stringify(GEAR_VALUES)); console.log(deriveGear({payload:{gear:"hotfix"}})); try{deriveGear({payload:{gear:"turbo"}});process.exit(1)}catch(e){console.log("throw:"+e.message)}'
# 期望：["default","hotfix","segmented"] / hotfix / throw:invalid_gear: turbo
```

**硬阈值**: GEAR_VALUES == `['default','hotfix','segmented']`；合法值透传；非法值 throw。

---

### Step 2: kernel run 落 gear 到 initiative_runs.gear，进程可查

**来源**: `[FROM_PRD]` — PRD 步骤 2「读入并持久化」。

**可观测行为**: `createKernelRun({..., gear:'hotfix'})` 后 `SELECT gear FROM initiative_runs WHERE id=$run` == `'hotfix'`；不传 gear 时列写 NULL。

**验证命令**（真 PG，由集成测试执行）:
```bash
# 见 ## E2E 验收 段：kernel-gear-dispatch.pg.integration.test.js:193-243 真 round-trip
```

**硬阈值**: gear='hotfix' round-trip == 'hotfix'；缺省列 == NULL。

---

### Step 3: ground-truth 每跳把 run.gear 注入 observed（缺省 default）

**来源**: `[FROM_PRD]` — PRD 步骤 2 尾「ground-truth.js 每跳把 run.gear 注入 observed，缺省 'default'」。

**可观测行为**: `collectGroundTruth` 现查 run 行 → `observed.gear === 'hotfix'`；run.gear NULL → `observed.gear === 'default'`。

**验证命令**（真 PG，集成测试执行）: 见 `## E2E 验收`（integration test:216,241）。

**硬阈值**: observed.gear 等于持久化值；NULL 降级 'default'。

---

### Step 4: derive.js 按档分叉（位置在所有 gear 无关守卫之后、planning 门之前）

**来源**: `[FROM_PRD]` — PRD 步骤 3 + `[AI_ADDED]` 分叉位置守卫顺序（理由：外部终态真相/在途观测优先于分档判定，防止分档越过 terminal/inflight 守卫造成双 spawn）。

**可观测行为**:
- gear=hotfix && 初始态（!prdExists && !contract.approved）→ `{phase:'generate', action:'spawn:generator'}`（跳 planning/gan）。
- gear=default/undefined/segmented 初始态 → `{phase:'planning', action:'spawn:planner'}`（零回归）。
- gear 非法 → `{phase:'failed', action:'mark_failed', reason:'invalid_gear'}`（fail-closed）。

**验证命令**（纯函数真调，proposer 已实跑）:
```bash
npx vitest run sprints/08091130-kernel-gear-dispatch/tests/derive-gear.test.js
# 期望：Test Files 1 passed / Tests 6 passed（hotfix≠planner、hotfix 不派三角色、default/缺省/segmented=planner、turbo=invalid_gear）
```

**硬阈值**: 6 test 全绿；hotfix action != spawn:planner 且 == spawn:generator；turbo reason == invalid_gear。

---

### Step 5（出口）: harness_attempts 角色分布反映该档相位链

**来源**: `[FROM_PRD]` — PRD 步骤 4「可观测出口」+ E2E 验收点 1&2（表名已更正为 harness_attempts）。

**可观测行为**: hotfix run 的 `harness_attempts` 无 planner/proposer/reviewer 行、有 generator 行（>=1）；default run 有 planner 行（>=1）。带 10 分钟时间窗防历史冒充。

**验证命令**（真 PG，集成测试执行）:
```bash
# harness_attempts a JOIN initiative_runs r ON r.id=a.run_id
# WHERE r.gear='hotfix' AND role IN ('planner','proposer','reviewer') AND created_at > NOW()-interval '10 minutes' → count == 0
# WHERE r.gear='hotfix' AND role='generator' ... → count >= 1
# WHERE COALESCE(r.gear,'default')='default' AND role='planner' ... → count >= 1
```

**硬阈值**: hotfix 三 GAN 角色 count == 0；hotfix generator count >= 1；default planner count >= 1。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 全程无 UI / 无远端 agent / 无真机；验收 = 纯函数 derive 单测（三档分叉）+ 真 Postgres 集成（gear round-trip + observed 注入 + harness_attempts 角色分布）。真 PG 由集成测试自举隔离空库（真跑 migrate 至 396），仅替身最外层 launcher/dispatch exec（见「禁 mock 边清单」）。

```bash
#!/bin/bash
set -euo pipefail

# 真 Postgres 由 Fleet / brain-integration 注入（DB_HOST/DB_PORT/DB_USER/DB_PASSWORD，
# 需 CREATE DATABASE 权限——集成测试自举隔离空库并真跑仓库 migration 至 396_initiative_runs_gear）。
# 本 sprint 无业务 signup/login/tenant（cecelia 内部 kernel，非外部用户），业务登录自举 N/A。
: "${DB_HOST:?Fleet must inject Postgres host for brain-integration}"

cd "$(git rev-parse --show-toplevel)"

# ---- 层1：纯函数单测 — derive 三档分叉（PRD 验收点3 + 零回归 + fail-closed）----
UNIT_LOG=/tmp/gear-unit.log
npx vitest run sprints/08091130-kernel-gear-dispatch/tests/derive-gear.test.js 2>&1 | tee "$UNIT_LOG"
grep -q "No test files found" "$UNIT_LOG" && { echo "FAIL: 单测文件未被发现（vitest include 假绿陷阱）"; exit 1; }
grep -qE "Test Files[[:space:]]+1 passed" "$UNIT_LOG" || { echo "FAIL: derive 三档单测未全绿"; exit 1; }
grep -qE "Tests[[:space:]]+6 passed" "$UNIT_LOG" || { echo "FAIL: derive 单测通过数 != 6"; exit 1; }

# ---- 层2：真 PG 集成 — gear round-trip + observed 注入 + harness_attempts 角色分布（PRD 验收点1&2）----
PG_LOG=/tmp/gear-pg.log
( cd packages/brain && NODE_ENV=test npx vitest run --config vitest.integration.config.js kernel-gear-dispatch.pg.integration 2>&1 ) | tee "$PG_LOG"
grep -q "No test files found" "$PG_LOG" && { echo "FAIL: 集成测试未被发现（include 范围外假绿陷阱）"; exit 1; }
grep -qE "Test Files[[:space:]]+1 passed" "$PG_LOG" || { echo "FAIL: 真 PG 集成测试未全绿（gear round-trip / harness_attempts 角色分布）"; exit 1; }

echo "✅ Golden Path 验证通过：kernel 真读 gear 三档分流（derive 分叉 + initiative_runs.gear 落库 + harness_attempts 角色分布）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；本 sprint 纯状态机，风险面窄）
高风险面:
- 错输入: gear 传大小写变体 `"Hotfix"`/`"DEFAULT"`、空串 `""`、纯空格 → 应 fail-closed（不在 GEAR_VALUES）走 invalid_gear，不得静默降级 default。
- 重复提交: 同 initiative 连派两条不同 gear → 后派是否覆盖 `initiative_runs.gear`（`createKernelRun` 已有 active run 时返回 `{created:false}`，验不重复建 run）。
- 中途中断: run 已过初始态（prd 已落盘）后再看 gear=hotfix → derive 应落到 gear 无关的 GAN/task 主线（hotfix 分叉仅在初始态 `!prdExists && !contract.approved` 触发），不得回跳 generate。
- 边界值: gear=NULL vs 缺省 vs `'default'` 三者 observed 均须归一到 'default'（`COALESCE`/`?? 'default'`）。
发现分级: P0/P1（default 转红 = 零回归破线 / 非法 gear 静默降级）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期证据 |
|---|---|---|---|
| derive 三档分叉（纯函数） | `sprints/08091130-kernel-gear-dispatch/tests/derive-gear.test.js` | `不等于 spawn:planner`；`三角色 spawn 均不出现`；`返回 spawn:planner`；`等价 default`；`照跑 planner`；`invalid_gear` | → 6 passed（proposer 已实跑绿；见交付状态提示） |
| gear round-trip + 角色分布（真 PG） | `packages/brain/src/__tests__/integration/kernel-gear-dispatch.pg.integration.test.js`（存量） | `gear 列可 round-trip`；`列写 NULL 且降级 default`；`hotfix 首角色 generator 无 planner/proposer/reviewer；default 首角色 planner` | → Test Files 1 passed（brain-integration job 真 PG） |

> 「BEHAVIOR 覆盖」列每个覆盖名均为对应 `it()` 测试名的字面子串（`grep -F` 可命中）。
