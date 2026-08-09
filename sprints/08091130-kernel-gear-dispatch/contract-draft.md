# Sprint Contract Draft (Round 2)

**journey_type**: autonomous
**target_environment**: local_api
**锚定父路**: 覆盖父路 工厂·F1 开发闭环 · 步1「接单进车间即分档」(step 3bf6c116-169c-46ec-bc7c-b335a22f80ec)

> **Round 2 修订说明（堵 R1-1）**：R1 Reviewer 裁定 REVISION，唯一阻塞 R1-1 = segmented 档零验证（DoD/两份测试仅覆盖 hotfix/default/非法 turbo，segmented 合法性与持久化无 oracle）。本轮按 Reviewer 修复建议原样补齐：(a) derive-gear 单测增 `gear=segmented 初始态 action 等于 spawn:planner`；(b) 集成测试增 `segmented run 合法持久化且不 fail-closed`（新 sentinel initiative_id）；(c) DoD 增 B-07/B-08；(d) 本 ## E2E 验收 psql 段增 segmented 复核。segmented 是 GEAR_VALUES 第三合法值，必须被 kernel 合法集当合法值透传（走 planner）、非与 turbo 同路径 fail-closed。其余 6 维 R1 均 ≥7，本轮不动（净变化仅补 segmented 覆盖，不蔓延 scope）。

gp-anchor: skipped (product-map.json not found)
contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在），走代码层 Contract Gate 常规逻辑

---

## Response Schema（推导来源: PRD 字面 — 本任务无 HTTP 响应）

N/A — 任务无 HTTP 响应。本 sprint 改动是 kernel 纯后端状态机（`orchestrator/derive.js` 纯函数 + `orchestrator/run.js`/loop 启动读取持久化），无对外 endpoint。可观测契约是 **DB 行为**（`initiative_runs.gear` 列 + `harness_attempts` 的 role 分布），验证靠 psql + 纯函数单测，不靠 curl。Reviewer 第 6 维按 DB oracle 完整性审查。

> **表名纠正（真读代码，代码即 SSOT）**：PRD 验收原文写 `initiative_attempts`，但仓库中**不存在**该表/视图（`grep initiative_attempts packages/brain` = 0 命中）。真实承载 attempt 的表是 `harness_attempts`（migration 357，含 `run_id UUID REFERENCES initiative_runs(id)`、`role TEXT CHECK (role IN ('planner','proposer','reviewer','generator','evaluator','judge','reporter'))`、`created_at TIMESTAMPTZ`）。本合同所有验证命令一律以 `harness_attempts` 为准；这是"翻译对齐代码 SSOT"，非字段漂移。判定点登记表已登记该纠正。

---

## 已知约束（来自回归测试 + 累积 FR）

- [回归测试 derive.test.js:735] `!prd存在 → phase=planning, action=spawn:planner` — **零回归铁律**：gear 缺省/default 时初始态必须仍返回 `spawn:planner`，本合同 B-06 守此。
- [回归测试 harness-skill-relay.test.js:479] `非法值 → throw Error 含 invalid_gear` — `deriveGear` 已是 gear 枚举 SSOT，本 sprint 只读复用，不改其实现。
- [回归测试 harness-orchestrator-lockdown.test.js:307] `SC-204: payload.gear 非法值 → task failed reason=invalid_gear`（executor.js:3090 相位）——kernel 侧 fail-closed 必须对齐同一 reason 字面 `invalid_gear`。
- [累积FR] context-manifest: unavailable（proposer 运行环境 runtime_resources.postgres=false，Brain 5221 不可达，累积 FR 端点未取；PRD 已声明本 line 暂无已验收历史 ability）。
- [代码事实] `derive(observed)` 的 `REQUIRED_FIELDS` 不含 `gear`；新增读取必须把 `gear` 设为**可选**字段（缺省归一 `default`），否则现存全部 derive 单测（不传 gear）会因 assertObservedShape 抛错 = 破坏零回归。
- [代码事实] `deriveGear(task)` 读的是 `task?.payload?.gear`（harness-skill-relay.js:85），kernel 侧读同一 payload 字段，不新建平行枚举。

---

## 真实调用方请求 shape

本 sprint 无「设备/agent 调服务端」的外部 HTTP 调用方（纯 kernel 内部状态机）。gear 的唯一来源是 **harness_initiative task 的 `task.payload.gear`**，与 `executor.js:521` 消费的字段字面同源（`deriveGear(task)` 读 `task.payload.gear`）。kernel 侧读取路径必须复用同一 `deriveGear` + `GEAR_VALUES`，禁止在 kernel 新建平行 gear 字段或平行枚举（否则两条路径分叉，同 #1267 双路径病根）。

---

## 禁 mock 边清单

本单改动涉及【状态机】（derive.js 初始态分叉）+【跨模块数据传递】（gear 从 task.payload → run context → observed → derive）+【DB 写路径】（initiative_runs 新增 gear 持久化）——三类接缝全命中，failing test 必须不 mock 被改的边：

- **derive.js 纯函数 ↔ observed.gear**（本单改状态机读 gear 分叉）→ 测试必须真调 `derive()`，禁 stub/mock derive 或其分支；纯函数无依赖，直接真调。
- **run.js/loop 启动 ↔ initiative_runs 表**（本单新增 gear 持久化写路径）→ 测试必须真 Postgres 验 `initiative_runs.gear` 真落列，禁 mock pool/attemptStore 的写。
- **collectGroundTruth/loop ↔ derive**（gear 从 task.payload/initiative_runs 行接力到 observed 的跨模块传递）→ 集成测试真调这条接力链，禁 mock ground-truth 对 gear 的读出。
- **kernel dispatch ↔ harness_attempts 表**（role 分布断言的数据源）→ role 计数必须真 PG 查真 `harness_attempts` 行，attempt 行由真实 `attemptStore.createAttempt` 写入。

允许 mock 的**更外层无关依赖**：docker 容器 spawn（`spawnDetached`/launcher）——用录制式 launcher 替身记录"本应 spawn 哪个 role"，但 attempt 行仍走真实 attemptStore 落真 PG；provider 真机执行/agent 回调的具体产物内容（用测试注入的 callback/decision-log 行推进相位，属真实回调路径，非 mock 被改的边）。

---

## Golden Path

覆盖父路 工厂·F1 开发闭环 · 步1「接单进车间即分档」(step 3bf6c116)

[kernel run 启动读 task.payload.gear] → [归一/校验 gear（缺省→default，非法→fail-closed）] → [持久化 gear 到 initiative_runs 并可查] → [derive.js 初始态按 gear 分叉] → [harness_attempts 的 role 分布随 gear 可观测变化]

---

### Step 1: kernel run 启动读 gear 并持久化到 initiative_runs
**来源**: `[FROM_PRD]` — Golden Path 第 1 条 + 「必须实现」第 1 点（"gear 从 task.payload 读进 kernel run context 并持久化到 initiative_runs，kernel 进程启动时可查"）。

**可观测行为**: kernel 进程（`orchestrator/run.js`/loop 启动）从 `task.payload.gear` 读 gear，经 `deriveGear` 归一（缺省/null → `default`；合法值透传），并写入 `initiative_runs` 该 run 行的 `gear` 列；启动后任意进程可 `SELECT gear FROM initiative_runs WHERE id=$run` 查到。

**验证命令**:
```bash
# 前置：DATABASE_URL=$DB_URL，跑真实 migration 后 initiative_runs 有 gear 列
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name='gear'" | grep -qx 1
# 集成测试驱动一条 gear=hotfix 的 kernel run 启动后：
psql "$DB_URL" -tAc "SELECT gear FROM initiative_runs WHERE initiative_id='00000000-0000-4000-8000-00000000f1c5' AND created_at > NOW() - interval '10 minutes' ORDER BY created_at DESC LIMIT 1" | grep -qx hotfix
```

**硬阈值**: `initiative_runs.gear` 列存在（count=1）；hotfix run 落库 `gear='hotfix'`。

---

### Step 2: 非法 gear 在 kernel 侧 fail-closed
**来源**: `[FROM_PRD]` — 「必须实现」第 3 点 + 边界情况（"gear 非法值 → kernel 侧 fail-closed，标 terminal failed reason=`invalid_gear`，不 spawn 任何相位"），处理形态对齐 `executor.js:3090`。

**可观测行为**: `task.payload.gear` ∈ 非 `GEAR_VALUES`（如 `turbo`）时，kernel 启动即 `deriveGear` 抛错 → finalize 该 run 为 terminal failed，`failure_reason` 含 `invalid_gear`，且**不产生任何 harness_attempts 行**（不 spawn 任何相位）。

**验证命令**:
```bash
# 集成测试驱动一条 gear=turbo 的 kernel run 后：
psql "$DB_URL" -tAc "SELECT failure_reason FROM initiative_runs WHERE initiative_id='00000000-0000-4000-8000-0000000baad0' AND created_at > NOW() - interval '10 minutes' ORDER BY created_at DESC LIMIT 1" | grep -q invalid_gear
BAD_RUN=$(psql "$DB_URL" -tAc "SELECT id FROM initiative_runs WHERE initiative_id='00000000-0000-4000-8000-0000000baad0' AND created_at > NOW() - interval '10 minutes' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts WHERE run_id='$BAD_RUN'" | grep -qx 0
```

**硬阈值**: `failure_reason` 含 `invalid_gear`；该 run 的 `harness_attempts` 行数 = 0。

---

### Step 3: derive.js 初始态按 gear 分叉（hotfix 跳 planning/gan 直进 generate）
**来源**: `[FROM_PRD]` — Golden Path 第 2 条 + 「必须实现」第 2 点 + 单测验收第 3 条（"derive() 喂 gear=hotfix 的 observed 初始态，返回 action 不等于 spawn:planner"），决策 1b677ae3 原文"免 planner/GAN 但保留评估"。

**可观测行为**: `derive(observed)` 纯函数在初始态（run 未起步、`prdExists=false`、无 pr、`generatorSpawned=false`）按 `observed.gear` 分叉：
- `gear='default'`（或缺省）→ `action='spawn:planner'`（零回归，一字不改）。
- `gear='hotfix'` → 跳过 planning + GAN 两相位，`action='spawn:generator'`（≠ `spawn:planner`）；contract approved 之后的 generator→evaluator→judge 链路保留不变。
- `gear='segmented'` → 初始态 `action='spawn:planner'`（planner 照跑；分段语义在下游 proposer 多段 task-plan 实现，见范围说明），与 default 初始态一致但 gear 已持久化供下游消费。**关键**：segmented 是 `GEAR_VALUES` 第三合法值，kernel 合法集校验必须把它当合法值透传（走 planner、gear 落库 `segmented`），**禁止**因漏出合法集而与 `turbo` 同路径 fail-closed（R1-1 修复点）。

**验证命令**:
```bash
# 纯函数单测（无需 DB），直接真调 derive；覆盖 hotfix/default/segmented 三档初始态分叉
npx vitest run packages/brain/src/orchestrator/__tests__/derive-gear.test.js --reporter=dot
```

**硬阈值**: 单测 exit 0；`derive(hotfix 初始态).action === 'spawn:generator'` 且 `!== 'spawn:planner'`；`derive(default 初始态).action === 'spawn:planner'`；`derive(segmented 初始态).action === 'spawn:planner'`（合法档，非 fail-closed）。

---

### Step 4: harness_attempts 的 role 分布随 gear 可观测变化
**来源**: `[FROM_PRD]` — Golden Path 第 3 条 + 单测/psql 验收第 1、2 条（表名按代码 SSOT 纠正为 `harness_attempts`）。

**可观测行为**: 跑完整一条 kernel run（录制式 launcher，attempt 行真落 PG）后，`harness_attempts` 按 role 计数：
- `gear='hotfix'` run：`role IN ('planner','proposer','reviewer')` 记录数 = 0，`role='generator'` 记录数 ≥ 1。
- `gear='default'` run：`role='planner'`、`role='proposer'`、`role='reviewer'` 三者记录数均 ≥ 1（零回归）。

**验证命令**:
```bash
# 集成测试驱动两条 run（hotfix + default）后：
HOTFIX_RUN=$(psql "$DB_URL" -tAc "SELECT id FROM initiative_runs WHERE initiative_id='00000000-0000-4000-8000-00000000f1c5' AND gear='hotfix' AND created_at > NOW() - interval '10 minutes' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts WHERE run_id='$HOTFIX_RUN' AND role IN ('planner','proposer','reviewer') AND created_at > NOW() - interval '10 minutes'" | grep -qx 0
psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts WHERE run_id='$HOTFIX_RUN' AND role='generator' AND created_at > NOW() - interval '10 minutes'" | awk '$1>=1{exit 0} {exit 1}'
```

**硬阈值**: hotfix run planner/proposer/reviewer 计数 = 0 且 generator ≥ 1；default run 三角色均 ≥ 1；查询均带 `created_at > NOW() - interval '10 minutes'` 时间窗防历史数据冒充。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 系统对外承诺做什么 | kernel（orchestrator/run.js+loop）启动真读 `task.payload.gear`、经 `deriveGear` 归一、持久化到 `initiative_runs.gear`；`derive.js` 初始态按 gear 分叉（hotfix 跳 planning/gan 直进 generate、default/segmented 走 planner）；非法 gear kernel 侧 fail-closed |
| **NFR（做得多好）** | 性能/可靠性/并发阈值 | 无显式 NFR（PRD 未指定超时/频控）；约束：segmented 段循环不新增 Brain 任务、不改 dispatcher 并发模型 |
| **Invariant（永不违反）** | 不变量 | ①gear=default 现行为一字不改（零回归）②gear 合法集唯一真相=GEAR_VALUES，非法值全链 fail-closed ③derive 现存单测（不传 gear）不得因新字段抛错（gear 可选） |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | gear 枚举随 `GEAR_VALUES` 演进；本 sprint 不建 param 档（交付物 3）——新增档位需回改 GEAR_VALUES SSOT，kernel 只读复用自动跟进 |
| **死亡告警（停了谁知道）** | 停止工作谁知道 | gear 分叉失效 → harness_attempts role 分布回退全 default（planner 恒出现）；本 sprint 验收即以 role 计数为死亡探针；生产侧靠 kernel run 的 initiative_runs.gear 落库缺失/恒 default 可 psql 巡检 |
| **失败语义（挂了怎么办）** | 故障放行还是拦截 | 见下方失败语义声明——非法 gear=拦截（fail-closed terminal failed）；gear 列写入失败=run 启动失败（不静默降级 default，否则掩盖问题） |
| **效果确认（已发≠已生效）** | 回执验证 | gear 持久化后 `SELECT gear FROM initiative_runs` 可查回；分叉生效后 `harness_attempts` role 分布真变——两者均 psql 可复核，非"日志说改了" |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ gear 分叉判定用哪张表核实 role 分布 | A. `initiative_attempts`（PRD 原文）; B. `harness_attempts`（代码真实表） | B. `harness_attempts` | grep 全仓 `initiative_attempts`=0 命中，代码 SSOT 是 `harness_attempts`（migration 357，role 列 + run_id FK initiative_runs） | 用不存在的表名 → 验证命令必挂/静默假绿，判定点直接失效 |
| ⚠️ hotfix「跳过 gan」是否真的没 spawn reviewer/proposer | A. 只看 derive 返回值; B. 查 harness_attempts 该 run role 计数=0 | B. + A 双证（单测证 derive 分叉 + PG 证真无 attempt 落库） | 单测只证决策，落库计数才证真没派发 | 只信 derive 返回 → 若 dispatch 层仍派了 planner 会漏过 |
| gear 缺省/null 归一到哪个档 | A. 缺省报错; B. 缺省=default | B. 缺省/null=default | PRD 边界情况 + deriveGear 现行为（缺省 return 'default'） | 缺省报错 → 存量 192 条裸任务全炸 = 破坏零回归 |
| gear 持久化用新列还是 run_context JSON | A. 新增 initiative_runs.gear 列; B. 塞进 JSON 列 | A. 新增 `gear` 列（可 psql 直查、可加 CHECK 约束） | PRD 假设允许"新增列或 run_context JSON"，列更利于 psql 验收与索引 | 塞 JSON → 验收 psql 需 `->>` 解析，且无 CHECK 约束护栏 |

> 无接缝真机判定点（纯后端状态机 + DB，无真机 RPA/外部状态推断）。⚠️ 行为误判后果严重（静默假绿/掩盖零回归破坏）的判定点，已在 PrepPRD/决策 e8f6134f「三条边界拍板」拍过（缺省=default、非法 fail-closed、GEAR_VALUES 单源），无新增待确认 ⚠️ 判定点。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503，不写 DB | 是（幂等键=task_id） | 客户端重试 |
| gear 非法值（∉ GEAR_VALUES） | kernel 启动即 finalize run terminal failed，reason=`invalid_gear`，不 spawn 任何相位 | 是（同一 task 重跑仍 fail-closed，无副作用 attempt） | 无降级——拦截，不放行（对齐 executor.js:3090） |
| gear 列写入失败（DB 异常） | run 启动失败（沿用现有 kernel_process_fatal 兜底），不静默降级 default | 是 | 不静默吞——写不进就是启动失败，避免掩盖 |
| gear 缺省 / null | 归一为 `default`，正常启动，现行为 | 是 | 这是正常路径非失败（零回归） |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 无对外暴露 agent / 无外部用户可写入接口。gear 来源是内部 harness_initiative task.payload，由 Brain executor/harness 派发链产生，非公网入口（入口强制是交付物 4，明确不在本 sprint 范围）。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## 未覆盖真实链路清单

| 被 mock 顶替的真实链路点 | 为什么 | 真验证补位计划（谁/何时/什么环境） |
|---|---|---|
| docker 容器 spawn（`spawnDetached`/launcher 真实拉起 agent 容器） | 集成测试用录制式 launcher 替身：记录"本应 spawn 哪个 role"并让 attempt 行走真实 attemptStore 落真 PG，但不真拉 Docker 容器（CI/evaluator 环境无法真跑 Claude/codex 容器 fleet） | 被改的边（derive 分叉 / gear 持久化 / harness_attempts role 落库）全部真跑真 PG，不属 mock 豁免；docker spawn 属"有枪没上膛"之外的更外层依赖。真机 fleet 端到端由生产 kernel run 自然覆盖（近 30 天已跑 192 条 kernel-v1），本 sprint merge 后首条 gear=hotfix 生产 run 的 initiative_runs.gear + harness_attempts role 分布即真机补位证据 |
| agent 回调产物（真实 PR/verdict 内容） | 集成测试用注入的真实 callback/decision-log 行 + 落盘 prd/contract 产物推进相位（走真实 ground-truth 读取路径），不真跑 generator/evaluator/judge 产出真 PR | 相位推进走真实回调路径（非 mock 被改的边）；default run 三角色 attempt 落库即证 planning→gan 相位真被 dispatch |

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `task.payload.gear` 传大小写混杂（`Hotfix`/`HOTFIX`）、空串 `""`、数字 `0`、布尔 `false` —— 验证是否严格按 `GEAR_VALUES` 精确匹配 fail-closed，还是被 JS 隐式转换绕过
- 重复提交: 同一 task 已有 active kernel run 时二次启动（createKernelRun 幂等分支）——gear 持久化是否幂等、不会写出两条 gear 冲突的 run 行
- 中途中断: gear 已持久化但进程在 derive 前崩溃重拉——重拉后 collectGroundTruth 从 initiative_runs.gear 读回是否与首次一致（gear 不能只存内存，必须落库可复原）
- 边界值: derive observed 完全不含 gear 字段（老快照回放）——必须归一 default 不抛错（零回归护栏）；gear=segmented 但下游 task-plan 只有单 ws1（segmented 语义未落地时的降级行为）
发现分级: P0/P1（破坏零回归 / 非法 gear 未 fail-closed / gear 未落库）→ 阻塞 merge；P2/P3（segmented 下游细节）→ 记 findings 不阻塞

---

## 集成测试驱动约定（generator 实现的 seam）

真 PG 集成测试（`kernel-gear-dispatch.integration.test.js`）需要一个驱动器把 kernel run 跑到自然终态、attempt 真落 `harness_attempts`，但不真拉 Docker 容器。generator 必须提供一个测试驱动器（放 `packages/brain/src/orchestrator/__tests__/kernel-gear-testkit.js` 或等价位置）：

- **签名**: `driveKernelGearRun({ pool, gear, initiativeId }) → Promise<{ runId, failed? }>`
- **必须真跑的边（禁 mock）**: 真 `derive`（读 observed.gear 分叉）、真 `initiative_runs` gear 持久化写、真 `attemptStore.createAttempt` 落真 `harness_attempts`。
- **允许的替身**: 只替 docker 容器 spawn（录制式 launcher）；相位推进用真实 callback/decision-log 行注入（走真实 ground-truth 读取路径）。
- **合法 gear**: 驱动到派发出对应 role 的 attempt 行（hotfix 只到 generator；default 与 segmented 均走 planner→proposer→reviewer→…，segmented 分段语义在下游 proposer 多段 task-plan 实现，kernel 初始态与 default 同为 spawn:planner，仅 gear 落库值不同）。
- **非法 gear**: 返回 `{ runId, failed:true }`，run finalize terminal failed reason 含 `invalid_gear`，且**不产生任何** `harness_attempts` 行。
- **落 committed sentinel 行**: 用上述固定 sentinel `initiativeId` 落 committed 行（不回滚），供 `## E2E 验收` 外部 psql 复核；`created_at` 用真实 NOW()（时间窗防造假）。

驱动器只是把"跑一条 kernel run"封装成可在测试里调用——它不得绕过 derive/gear 持久化/attempt 落库这三条被改的边（那样等于 mock 被测核心）。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> evaluator 模式 B：在注入 `$DB_URL` 的隔离空库上跑真实 migration bootstrap，再跑纯函数单测 + 真 PG 集成测试（录制式 launcher，attempt 行真落 PG），最后直接 psql 复核 hotfix/default/invalid 三条 run 的 `initiative_runs.gear` 与 `harness_attempts` role 分布。全部 exit-code 驱动，禁 mock 被改的边。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"
cd "${WORKSPACE_PATH:-/workspace}"

# 1. 空库 bootstrap：跑仓库真实 migration，机检目标表/列存在
node packages/brain/scripts/migrate.mjs 2>/dev/null \
  || node packages/brain/src/migrate.js 2>/dev/null \
  || npm --prefix packages/brain run migrate
psql "$DB_URL" -tAc "SELECT to_regclass('harness_attempts') IS NOT NULL" | grep -qx t
psql "$DB_URL" -tAc "SELECT to_regclass('initiative_runs') IS NOT NULL" | grep -qx t
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name='gear'" | grep -qx 1

# 2. 纯函数 derive gear 分叉单测（无需 DB）
npx vitest run packages/brain/src/orchestrator/__tests__/derive-gear.test.js --reporter=dot

# 3. 真 PG 集成：驱动 hotfix/default/segmented/invalid 四条 run（录制式 launcher，attempt 真落 PG），
#    并落 committed sentinel run（固定 initiative_id）供下方 psql 外部复核
DATABASE_URL="$DB_URL" npx vitest run packages/brain/src/orchestrator/__tests__/kernel-gear-dispatch.integration.test.js --reporter=dot

# 4. psql 复核 hotfix run：role 分布（planner/proposer/reviewer=0 且 generator>=1）
HOTFIX_RUN=$(psql "$DB_URL" -tAc "SELECT id FROM initiative_runs WHERE initiative_id='00000000-0000-4000-8000-00000000f1c5' AND gear='hotfix' AND created_at > NOW() - interval '10 minutes' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
[ -n "$HOTFIX_RUN" ] || { echo "FAIL: 无 hotfix sentinel run 落库"; exit 1; }
NON_GEN=$(psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts WHERE run_id='$HOTFIX_RUN' AND role IN ('planner','proposer','reviewer') AND created_at > NOW() - interval '10 minutes'" | tr -d ' ')
GEN=$(psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts WHERE run_id='$HOTFIX_RUN' AND role='generator' AND created_at > NOW() - interval '10 minutes'" | tr -d ' ')
[ "$NON_GEN" = "0" ] || { echo "FAIL: hotfix run 出现 planner/proposer/reviewer 记录数=$NON_GEN"; exit 1; }
[ "$GEN" -ge 1 ] || { echo "FAIL: hotfix run 无 generator 记录"; exit 1; }

# 5. psql 复核 default run：planner/proposer/reviewer 三角色均 >=1（零回归）
DEFAULT_RUN=$(psql "$DB_URL" -tAc "SELECT id FROM initiative_runs WHERE initiative_id='00000000-0000-4000-8000-00000000def0' AND gear='default' AND created_at > NOW() - interval '10 minutes' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
[ -n "$DEFAULT_RUN" ] || { echo "FAIL: 无 default sentinel run 落库"; exit 1; }
for r in planner proposer reviewer; do
  C=$(psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts WHERE run_id='$DEFAULT_RUN' AND role='$r' AND created_at > NOW() - interval '10 minutes'" | tr -d ' ')
  [ "$C" -ge 1 ] || { echo "FAIL: default run 缺 role=$r（计数=$C）"; exit 1; }
done

# 5b. psql 复核 segmented run（R1-1）：gear 合法落库='segmented'、不 fail-closed、planner>=1
SEG_RUN=$(psql "$DB_URL" -tAc "SELECT id FROM initiative_runs WHERE initiative_id='00000000-0000-4000-8000-00000000e6ed' AND gear='segmented' AND created_at > NOW() - interval '10 minutes' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
[ -n "$SEG_RUN" ] || { echo "FAIL: 无 segmented sentinel run 落库（segmented 被当非法值 fail-closed？）"; exit 1; }
SEG_FR=$(psql "$DB_URL" -tAc "SELECT coalesce(failure_reason,'') FROM initiative_runs WHERE id='$SEG_RUN'")
echo "$SEG_FR" | grep -q invalid_gear && { echo "FAIL: segmented 合法档被 finalize invalid_gear"; exit 1; }
SEG_PLANNER=$(psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts WHERE run_id='$SEG_RUN' AND role='planner' AND created_at > NOW() - interval '10 minutes'" | tr -d ' ')
[ "$SEG_PLANNER" -ge 1 ] || { echo "FAIL: segmented run planner 未照跑（计数=$SEG_PLANNER）"; exit 1; }

# 6. psql 复核非法 gear fail-closed：failure_reason 含 invalid_gear 且无 attempt 落库
BAD_RUN=$(psql "$DB_URL" -tAc "SELECT id FROM initiative_runs WHERE initiative_id='00000000-0000-4000-8000-0000000baad0' AND created_at > NOW() - interval '10 minutes' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
[ -n "$BAD_RUN" ] || { echo "FAIL: 无 invalid_gear sentinel run 落库"; exit 1; }
psql "$DB_URL" -tAc "SELECT failure_reason FROM initiative_runs WHERE id='$BAD_RUN'" | grep -q invalid_gear || { echo "FAIL: 非法 gear run 未标 invalid_gear"; exit 1; }
BAD_ATT=$(psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts WHERE run_id='$BAD_RUN'" | tr -d ' ')
[ "$BAD_ATT" = "0" ] || { echo "FAIL: 非法 gear run 仍 spawn 了 attempt 数=$BAD_ATT"; exit 1; }

echo "✅ kernel gear 三档分流 E2E 验证通过（hotfix 跳相位 / default 零回归 / segmented 合法走 planner / invalid fail-closed）"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| derive 初始态三档分叉 | `tests/derive-gear-fork.test.ts`（proposer 红证据）→ 落地 `packages/brain/src/orchestrator/__tests__/derive-gear.test.js` | `gear=hotfix 初始态 action 不等于 spawn:planner`；`gear=hotfix 初始态 action 等于 spawn:generator`；`gear=default 初始态 action 等于 spawn:planner`；`gear=segmented 初始态 action 等于 spawn:planner` | derive 当前忽略 gear → hotfix 仍返回 spawn:planner → 前两条 FAIL |
| gear 持久化 + role 分布 + segmented 合法 + fail-closed | `packages/brain/src/orchestrator/__tests__/kernel-gear-dispatch.integration.test.js`（真 PG） | `gear 持久化到 initiative_runs gear 列`；`hotfix run harness_attempts 无 planner proposer reviewer 且 generator 至少一条`；`default run harness_attempts 三角色均至少一条`；`segmented run 合法持久化且不 fail-closed`；`非法 gear kernel 侧 fail-closed reason invalid_gear` | 当前无 gear 列 / kernel 不读 gear → 集成断言 FAIL（需 DATABASE_URL，evaluator 侧真跑） |
