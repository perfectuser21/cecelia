# Sprint Contract Draft (Round 2)

> Round 2 修订（仅修封印闸结构性冲突，实体合同零改动）：Round 1 已被 reviewer 7 维全 ≥7 APPROVED，但封印闸 `FROZEN_CONTRACT_TEST_CONTRACT_UNREGISTERED` 拒绝——`tests/gate-e2e-driver.mjs`（辅助驱动，非 `it()` 测试）被计入冻结测试集却无法登记。本轮：①把驱动移出 `tests/` 到 sprint 根（不再计入冻结集），②Test Contract「BEHAVIOR 覆盖」列改为 `it()` 名连续子串（封印闸解析语义），③移除封印时点尚不存在的 integration 补充行（改注文表述）。Golden Path / DoD / 冻结 RED 测试语义逐字不变。

三镜头 capability-controller 前置门禁：`new_capability` 在四格路由器选 pipeline **之前**必经三镜头对抗（该不该做 / 边界 / 归位），强制产出一句 postcondition + NFR 三数（成本上限 / 时延上限 / 成功率下限）写入 Brain `decisions`（`category=nfr, level=step, target_type=journey_step`），fail-closed。

## 锚定父路声明

覆盖父路 journey e6f803f2（step aad25bdb）第 1-3 步（new_capability work request 进路由 → 四格分类前跑三镜头 → 判决+postcondition+NFR 三数落库过闸后继续路由）。

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 改动落在 Brain 内部路由/调度层（`work-router` / 新增 `capability-gate`），对外可观测面是 `decisions` 表落库与 fail-closed 抛错，非 HTTP 端点。Reviewer 第 6 维 schema 项自动满分；行为 oracle 由 [BEHAVIOR] decisions/psql 断言承担。

## 已知约束（来自回归测试 + 累积 FR）

- [work-router.test.js] `maps all four change kinds forward` → 四格 change_kind → pipeline='harness' 映射不得回退
- [work-router.test.js] `requires change_kind and strict normalized enums` → change_kind 必填、source/enum 严格校验不得放宽
- [work-router.test.js] `rejects equal-rank cross-profile overrides` → execution_profile 同级/降级 override 仍必须抛错
- [work-router.test.js] `returns a deterministic complete decision and never infers a repo` → routeWork 幂等、绝不臆测 repo
- [work-router.test.js] `resolves GitHub aliases only through Map repository facts` → repo 只经 Map facts 解析
- [累积FR] （本 line 暂无历史；journey e6f803f2 下 golden-paths 均 planned，无 done/working）

> 死规则映射：本 sprint 只在 `new_capability` 分支**前置**插入门禁，四格分类算法、非 new_capability 路径、override 校验逻辑一律不动 → 上述回归断言必须继续全绿。

## Golden Path

[new_capability work request 进 routeWork/createRoutedTask] → [选 pipeline 前先跑三镜头 capability-gate] → [三镜头产出 postcondition+NFR 三数落 decisions，过闸后继续四格路由；未过闸 fail-closed 拦截]

### Step 1: new_capability work request 进入路由
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条（`classifyWork`→`coding_mutation` 且 `change_kind=new_capability`）

**可观测行为**: 一个 `change_kind=new_capability` 的 coding_mutation 请求进入路由；`change_kind ≠ new_capability`（capability_change/bugfix/parameter_only）不触发门禁，路由行为不变。

**验证命令**:
```bash
DB_URL="$DB_URL" node sprints/09060615-kernel-aa069d30/gate-e2e-driver.mjs regression
# 期望：OK regression（bugfix→hotfix-v1 / parameter_only→parameter-only-v1 路由不变）
```
**硬阈值**: 非 new_capability 三条路径 pipeline 与 default_execution_profile 与改动前逐字相等（driver 断言，exit 0）

---

### Step 2: 选 pipeline 前跑三镜头 capability-gate（过闸落库）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2-3 条（三镜头对抗 + 一句 postcondition + NFR 三数写 decisions）

**可观测行为**: new_capability 过闸后，`decisions` 表新增一行 `category=nfr, level=step, target_type=journey_step, target_id=<step_id>, status=active`，`context.nfr` 含三数（cost_ceiling / latency_ceiling / success_floor），`decision` 字段为一句 postcondition。只有过闸的 new_capability 才继续进四格路由。

**验证命令**:
```bash
DB_URL="$DB_URL" node sprints/09060615-kernel-aa069d30/gate-e2e-driver.mjs pass 22222222-3333-4444-5555-666666666666
psql "$DB_URL" -tAc "SELECT count(*) FROM decisions WHERE category='nfr' AND level='step' AND target_type='journey_step' AND target_id='22222222-3333-4444-5555-666666666666' AND status='active' AND created_at > NOW() - interval '5 minutes'" | grep -qx 1
# 期望：driver OK pass + psql 计数=1（5 分钟时间窗防历史数据造假）
```
**硬阈值**: decisions 恰 1 行且 `context.nfr` 三键均为 number；driver exit 0

---

### Step 3: 未过闸 fail-closed 拦截（拒绝原因可查 / 落库失败不静默）
**来源**: `[AI_ADDED]` — GAN Round 1 加入（Round 2 沿用未改），理由：PRD 边界情况「判不该做/边界过宽→拦截不放行」「decisions 落库失败 fail-closed 不静默放行」必须有可执行 oracle，否则 generator 可用静默放行假绿

**可观测行为**: 三镜头判 reject → 抛 `capability_gate_rejected`（`.reason` 可查），不写 nfr，路由不放行；postcondition/NFR 三数不完整 → 抛 `capability_gate_contract_incomplete`，不写 nfr；decisions 落库失败 → 抛错传播，绝不返回 released。

**验证命令**:
```bash
DB_URL="$DB_URL" node sprints/09060615-kernel-aa069d30/gate-e2e-driver.mjs reject 33333333-4444-5555-6666-777777777777
DB_URL="$DB_URL" node sprints/09060615-kernel-aa069d30/gate-e2e-driver.mjs incomplete 44444444-5555-6666-7777-888888888888
# 期望：两条均 exit 0（reject→capability_gate_rejected 且 0 行；incomplete→capability_gate_contract_incomplete 且 0 行）
```
**硬阈值**: reject/incomplete 均 fail-closed 抛对应 code 且 decisions 该 step 0 行；driver exit 0

---

## 禁 mock 边清单

- work-router / createRoutedTask ↔ capability-gate（本单新增：new_capability 在选 pipeline **前**必调门禁；冻结测试与 driver 真调 `runCapabilityGate`，不 mock 这条前置调用边）
- capability-gate ↔ decisions DB 表（本单新增 nfr 写路径；真 PG 断言由 E2E driver(pg Client) + psql 时间窗 + generator integration test 覆盖，禁止用 fake db 冒充落库通过）
- 允许 mock 的更外层边：三镜头 LLM 判决 `adjudicate`（capability-controller 对抗本体，更外层第三方推理边界，注入确定性 verdict；登记于下方未覆盖真实链路清单）

## 真实调用方请求 shape

N/A — 无外部设备/agent 调用方。门禁在 Brain 进程内被 `routeWork`/`createRoutedTask` 调用，`request` 来自 `normalizeWorkRequest` 已校验的内部结构（`source/source_id/title/mutation_intent/declared_change_kind`），无跨进程认证 header/body 分叉。

## 未覆盖真实链路清单

- 三镜头 LLM 判决本体（capability-controller，`controllerSkillFor()` 选取）｜为什么：跑真 LLM 对抗不确定、成本高且属 PRD 范围外（「三镜头对抗提示词内部逻辑重写」不在范围）｜真验证补位计划：门禁把 `adjudicate` 作为注入点，生产接线由 `harness-skill-relay` 调 capability-controller relay session 产出 verdict；本 sprint 冻结测试 + E2E 用确定性 verdict 桩验证**门禁编排与落库/fail-closed**，LLM 对抗质量由上游 relay sprint 保证（generator：在 createRoutedTask 生产接线处传入真实 relay adjudicate；evaluator：不跑真 LLM）
- （除上述 LLM 判决注入外，本合同 DB 边与路由边均真实，无其他 mock 豁免）

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | new_capability 在四格路由选 pipeline 前必经三镜头 capability-gate；过闸产出一句 postcondition + NFR 三数写 decisions(category=nfr,level=step,target_type=journey_step)；未过闸拦截不放行 |
| **NFR（做得多好）** | 性能/可靠性 | 门禁为同步前置，正常路径新增 1 次 adjudicate + 1 次 decisions INSERT；PRD 未给运行时 NFR（时延上限是**产出物**由三镜头落 decisions，非本门禁自身阈值）→ 运行时 NFR 待定，不自造 |
| **Invariant（永不违反）** | 不变量 | 非 new_capability 路由行为逐字不变（四格映射/override 校验/repo 解析回归全绿）；门禁 fail-closed（reject/产物不完整/落库失败一律不放行） |
| **判定点（怎么知道）** | 模糊现实判断 | 见判定点登记表 |
| **保质期（何时过期）** | 失效/退役 | 门禁常驻，无 TTL；NFR 三数 decision `status=active`，退役由 decisions 生命周期管理（本 sprint 不涉退役） |
| **死亡告警（停了谁知道）** | 告警 | gp-ledger-readiness `orphan_nfr` 巡检会在 NFR cell 无 active nfr decision 时计数报警（既有守卫，本 sprint 落库口径与其查询逐字段对齐即被覆盖） |
| **失败语义（挂了怎么办）** | 故障策略 | 见失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | 过闸的可观测回执 = decisions 真行落库（psql 时间窗查得到）；拿不到落库 = 未过闸 = fail-closed 抛错 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | API 不稳定 | 静默丢消息 |
| ⚠️ 三镜头是否「过闸」 | A. adjudicate 返回 `decision==='pass'` 且 postcondition/NFR 三数齐全; B. 仅看 decision 字段 | A（decision=pass **且**产物完整才放行） | 产物不完整 = 能力无验收锚点 = 等于没过闸；PRD 明确「强制产出」 | ⚠️ 误判放行 → 无锚点能力进主链，下游无法验收（升拍板级，见 notes） |
| new_capability 是否触发门禁 | A. `change_kind==='new_capability'`; B. profile 强度==2 | A（口径与四格 CHANGE_KINDS 一致） | 与 work-router 现有枚举逐字对齐，避免双路径 | 漏触发 → 能力绕过门禁；误触发 → 非能力变更被拦 |

> notes（judgment-pending-user）: `judgment-pending-user: 三镜头是否过闸`——「产物不完整是否等同未过闸」PrepPRD/对齐会未显式拍板，本合同按 PRD「强制产出 postcondition+NFR」采 fail-closed（不完整即拦），待主理人确认口径。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 三镜头判 reject | 抛 `capability_gate_rejected`（reason 可查），不写 decisions，路由不放行 | 是（同 request 重跑仍 reject，无副作用） | 无降级（fail-closed，不放行） |
| postcondition/NFR 三数不完整 | 抛 `capability_gate_contract_incomplete`，不写 decisions | 是 | 无降级（fail-closed） |
| decisions 落库失败（DB 异常） | 抛错传播，绝不返回 released | 是（未落库，无孤儿行） | 无降级（fail-closed，PRD 边界明确） |
| adjudicate 本体异常 | 抛错传播，fail-closed | 是 | 无降级 |

### 输入对抗面

N/A — 门禁不直接暴露给外部用户输入；`request` 已由 `normalizeWorkRequest` 校验，`adjudicate` 为内部 relay 注入，非外部可写。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## E2E 验收（local_api — evaluator 用注入的 DB_URL 跑真 PG，本地/CI brain-integration）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"

# 1. 真实 schema bootstrap：从 DB_URL 解析离散连接参数，跑仓库真实 migrate.js（幂等），空库建全套 schema
eval "$(node -e 'const u=new URL(process.env.DB_URL);const p=u.pathname.replace(/^\//,"");process.stdout.write(`export DB_HOST=${u.hostname} DB_PORT=${u.port||5432} DB_NAME=${p} DB_USER=${decodeURIComponent(u.username)} DB_PASSWORD=${decodeURIComponent(u.password||"")}`)')"
node packages/brain/src/migrate.js
# 机检 decisions 表与本 sprint 依赖列存在（category/level/target_type/target_id/status/context）
psql "$DB_URL" -tAc "SELECT to_regclass('decisions') IS NOT NULL" | grep -qx t
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='decisions' AND column_name IN ('category','level','target_type','target_id','status','context')" | grep -qx 6

# 2. 过闸落库（Golden Path Step 2）：new_capability → decisions 出 nfr/step/journey_step 行
STEP_PASS=22222222-3333-4444-5555-666666666666
DB_URL="$DB_URL" node sprints/09060615-kernel-aa069d30/gate-e2e-driver.mjs pass "$STEP_PASS"
psql "$DB_URL" -tAc "SELECT count(*) FROM decisions WHERE category='nfr' AND level='step' AND target_type='journey_step' AND target_id='$STEP_PASS' AND status='active' AND created_at > NOW() - interval '5 minutes'" | grep -qx 1
psql "$DB_URL" -tAc "SELECT (context->'nfr' ? 'cost_ceiling') AND (context->'nfr' ? 'latency_ceiling') AND (context->'nfr' ? 'success_floor') FROM decisions WHERE target_id='$STEP_PASS' AND category='nfr' ORDER BY created_at DESC LIMIT 1" | grep -qx t

# 3. fail-closed 拦截（Golden Path Step 3）：reject / incomplete 均不放行且不落库
DB_URL="$DB_URL" node sprints/09060615-kernel-aa069d30/gate-e2e-driver.mjs reject 33333333-4444-5555-6666-777777777777
DB_URL="$DB_URL" node sprints/09060615-kernel-aa069d30/gate-e2e-driver.mjs incomplete 44444444-5555-6666-7777-888888888888
psql "$DB_URL" -tAc "SELECT count(*) FROM decisions WHERE category='nfr' AND target_id IN ('33333333-4444-5555-6666-777777777777','44444444-5555-6666-7777-888888888888')" | grep -qx 0

# 4. 回归（Golden Path Step 1）：非 new_capability 路由行为不变
DB_URL="$DB_URL" node sprints/09060615-kernel-aa069d30/gate-e2e-driver.mjs regression

echo "✅ Golden Path 验证通过（三镜头前置门禁：过闸落库 + fail-closed + 回归无破坏）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: adjudicate 返回畸形 verdict（decision 非 pass/reject、nfr 三数为字符串/负数/NaN）→ 门禁应 fail-closed，不得写半截行
- 重复提交: 同一 step_id 连跑两次 pass → decisions 是否幂等/是否堆积重复 active nfr 行（观察是否需 supersede 旧行，本 sprint 若不去重须至少不破坏 orphan_nfr 巡检语义）
- 中途中断: decisions INSERT 与 adjudicate 之间抛错 → 确认无孤儿行、无静默放行
- 边界值: nfr 三数为 0 / 极大值 / 边界（success_floor=1.0）→ 是否被当作缺失误拦
发现分级: P0/P1（静默放行未过闸能力 / 落库失败被吞）→ 阻塞 merge；P2/P3（重复行堆积等）→ 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 三镜头门禁控制逻辑（短路/拦截/fail-closed/落库编排） | `sprints/09060615-kernel-aa069d30/tests/capability-gate.test.ts` | 不调 adjudicate 不写 db / fail-closed 抛 capability_gate_rejected / fail-closed 抛 capability_gate_contract_incomplete / decisions 落库失败 / 返回 released 与门禁产物 | 目标模块 capability-gate.js 未实现，import 失败 → 全部 RED（已本地确认） |

> 注（BEHAVIOR 覆盖列已按封印闸解析语义修订）：本列每项均为 `capability-gate.test.ts` 内对应 `it()` 名的**连续子串**（封印闸 assertTestContractResolvable 与 CI check-test-coverage 用 it/test 名提取 + 双向小写子串匹配逐项校验），故禁用 `/ , 、 ; ；` 作为项内字符（parser 以 `[/,、;；]` 拆项）——例：`fail-closed 抛 capability_gate_rejected` ⊂ it 名 `三镜头判 reject：fail-closed 抛 capability_gate_rejected，拒绝原因可查，不写 nfr`。
> 注（本 sprint 唯一冻结测试）：`capability-gate.test.ts` 为本 sprint 冻结测试（v9.27 死规则强制，落盘且进 commit）。E2E 驱动 `gate-e2e-driver.mjs` 刻意置于 **sprint 根**而非 `tests/`——它是无 `it()` 的辅助驱动，若落在 `tests/` 会被封印闸 `frozenTestFiles`（`/tests/` 且扩展名含 `.mjs`）计入冻结测试集，而登记解析链 `parseTestContract` 只接受 `.test/.spec/.e2e/.sh`，`.mjs` 永远无法登记 → 结构性 `FROZEN_CONTRACT_TEST_CONTRACT_UNREGISTERED`（Round 1 seal_rejection 实证）。移出 `tests/` 后不再计入冻结集，路径引用全量同步。
> 注（禁 mock 边补充覆盖，非冻结测试、不入本表）：真 PG decisions 写路径除本 sprint 的 E2E 驱动（真 pg.Client + psql 时间窗）外，由 generator 在 `packages/brain/src/__tests__/integration/capability-gate.integration.test.js` 补一条 brain-integration CI 集成断言（createRoutedTask new_capability 过闸落真行 / reject 不建 task 不放行）。该文件由 generator 落地、CI 起真 Postgres 跑，不是冻结产物，故不登记进本表（封印时点尚不存在，登记会触发 read_error）。

> contract-gate: 本仓库存在 packages/brain/src/lib/contract-gate.js（cecelia），代码层 Contract Gate 生效，未跳过。
