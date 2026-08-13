# Sprint Contract Draft (Round 1)

> 锚定父路声明：独立小路（无父路）— PrepPRD step_id=none，本 sprint 修 kernel 容量口径，无既有 Golden Path 父路。
>
> contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在）→ 代码层 Contract Gate 生效，本合同断言按速查表写成 gate-clean。
>
> gp-anchor: skipped (product-map.json not found)
>
> map: [MAP_NOT_CONFIGURED] — task.payload.map_scope/map_repo 均为 null，不回退领域硬编码。
>
> validation identity：本合同为纯容量计算，不涉及任何 attempt_id/capability_snapshot_id 字面值，无需 late-bind 固化（搜索 UUID 字面值应为空）。

## Response Schema（推导来源: N/A — 任务无新增 HTTP 响应）

本 sprint 为 packages/brain 内部容量口径修复，**不新增/不修改任何 HTTP 端点响应 schema**。
唯一被间接影响的既有端点 `GET /capacity-budget` 的 `fleet[]` 元素形状保持不变：
`{ id, online, effective_slots, physical_capacity, pressure }`（不改字段名）。
Reviewer 第 6 维（verification_oracle_completeness）：无 HTTP 响应 → 该维自动满分基线；本合同验证力集中在纯函数/管道断言。

---

## Golden Path

覆盖父路：独立小路（无父路）。

`[采集本机资源 stats]` → `[computeCapacityFromStats 算 physical/effective]` → `[getRoleCapacity 折算角色槽]` → `[各角色派出可用槽 available]`

### Step 1: kernel 对 us-mac-m4（isLocal=true）采集真实 stats
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步「周期性采集 stats(cpuCores/totalMemMB)」

**可观测行为**: 空载 10 核 16GB 机器采回的 stats 使下游 physical_capacity ≥ 8（当前实测被算成 2，见下方现场证据）。

**现场证据（本合同起草时 v1.273.1 实测）**:
```bash
curl -sf localhost:5221/api/brain/capacity-budget | jq -c '.fleet[] | select(.id=="us-mac-m4")'
# 实测输出：{"id":"us-mac-m4","online":true,"effective_slots":1,"physical_capacity":2,"pressure":0.375}
# 对照：xian-mac-m4=16/7、xian-mac-m1=12/6 —— 唯独本机 physical=2（命中 calculatePhysicalCapacity 的 max(raw,2) 下限兜底）
```

**验证命令**（管道级，见 DoD B-01）:
```bash
cd "${WORKSPACE_PATH:-/workspace}/packages/brain"
node --input-type=module -e 'import { computeCapacityFromStats as c } from "./src/fleet-resource-cache.js"; const r = c({ platform: "Darwin arm64", cpu: { cores: 10, usagePercent: 24 }, memory: { totalGB: 16, usedGB: 6, usagePercent: 43 } }, { macPressureLevel: 0 }); if (!(r.physicalCapacity >= 8)) process.exit(1); console.log("physical", r.physicalCapacity);'
```

**硬阈值**: computeCapacityFromStats(10 核 16384MB).physicalCapacity ≥ 8。

**根因① 说明（取证优先）**: physical=2 的直接原因是本机 `collectLocalStats()` 采回的 totalMemMB/cpuCores 失真（疑运行时容器/资源受限视图，totalMemMb < SYSTEM_RESERVED_MB=5000 时 `(total-5000)*0.8` 为负 → raw 为负 → `max(raw,2)` 钳到 2）。generator 必须先打印 `collectLocalStats()` 实际返回值取证，再定采集修法（MAX_PHYSICAL_CAP / memPerTaskMb=400 保持不变）。**该采集修复的真实生效只能在 us-mac-m4 真运行环境经 capacity-budget 确认 → 见「接缝清单」，标 logic-done-pending。**

---

### Step 2: macOS 有效容量用内核自评压力等级折算（弃用 free% 推断）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步 + 根因②

**可观测行为**: darwin 上 `effective = floor(physical × (1-pressure))`，pressure 来自内核自评等级映射 `macOSPressureLevelToFraction`（Normal 0→0 / Warning 1→0.3 / Urgent 2→0.7 / Critical 3→1）；free%/used_ratio 路径**只在 sysctl 不可用（level=-1）时**兜底，不再是 darwin 主路径。

**接线的是「未接线恒空」的死链**: `platform-utils.js` 早有正确的 `getMacOSMemoryPressure()`（内核 vm.memory_pressure 0-3），但容量链一直用 `stats.memory.usagePercent`（free% 推断，macOS 语义下长期偏高，见 infra-status.js:108-114 注释教训）。本 sprint 把 `getMacOSMemoryPressure()` 接进容量链。

**验证命令**（见 DoD B-02 / B-03）:
```bash
cd "${WORKSPACE_PATH:-/workspace}/packages/brain"
node --input-type=module -e 'import { macOSPressureLevelToFraction as f } from "./src/platform-utils.js"; const e={0:0,1:0.3,2:0.7,3:1}; for (const k of [0,1,2,3]) if (f(k)!==e[k]) process.exit(1); if (f(9)!==-1) process.exit(1); console.log("mapping ok");'
```

**硬阈值**: 映射表 0→0/1→0.3/2→0.7/3→1 逐项精确相等；非 0-3 → -1（sentinel，caller 兜底）。darwin 且 level 有效时 pressure 采映射值（不采 free%）；level=-1 时回退 used_ratio 且不崩溃。

---

### Step 3: effective≥1 时轻角色（proposer 权重 2）保底至少可派 1 槽
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步 + 根因③「消灭 floor 归零死区」

**可观测行为**: `getMachineCapacity()` 对 us-mac-m4（effective_slots=1）请求 role=proposer（无 manual_dispatch）时，`available ≥ 1`（当前实测 0，见下方证据）。

**现场证据（管道级，本合同起草时实测 workspace 源码）**:
```bash
# 当前 getRoleCapacity({baseCapacity:1, role:"proposer"}).capacity === 0（floor(1/2)）
# 当前 production-probes.getMachineCapacity(effective_slots=1, proposer, 无 manual) → available === 0
# → 即 run 8783807c「all_execution_targets_exhausted 25 分钟、只能靠 manually_dispatched 豁免」的直接机制
```

**保底范围判定（⚠️ judgment-pending-user，见 DoD 判定点登记表）**: 保底施加于**轻角色（role_weight ≤ 2：commander/planner/reviewer/proposer/reporter）**——effective≥1 时 `capacity = max(1, floor(effective/weight))`；**重角色（weight=4：generator/evaluator/judge）保持 floor 门控 + manual override 语义不变**。
- 理由：现有 production-probes 两条测试是刻意设计的 SSOT——`generator/effective=3/weight4 → floor=0 → 应 blocked`（重角色算力不足时门控），`evaluator/effective=1/weight4/manual → override → available=1`（manual 兜底且不复活 drained）。PRD 验收 3 只约束 proposer(权重2)/effective=1，未约束重角色。取「轻角色保底」既满足验收 3，又零回归这两条既有语义。
- 反面：PRD 修法文字「任何角色至少可派 1 个」字面更宽（含重角色）。若采字面宽解，须改上述两条既有测试并可能让重角色挤上薄机器（overload 面客风险）。故此点标 ⚠️ 待 GAN Reviewer / 主理人拍板；本轮采**保守轻角色解**。

**验证命令**（见 DoD B-04 / B-05）:
```bash
cd "${WORKSPACE_PATH:-/workspace}/packages/brain"
node --input-type=module -e 'import { getRoleCapacity as g } from "./src/orchestrator/fleet-node/node-profile.js"; if (!(g({baseCapacity:1, role:"proposer"}).capacity >= 1)) process.exit(1); if (g({baseCapacity:0, role:"proposer"}).capacity !== 0) process.exit(1); if (g({baseCapacity:3, role:"generator"}).capacity !== 0) process.exit(1); console.log("floor guard ok");'
```

**硬阈值**: proposer base=1 → capacity≥1；proposer base=0 → 0（drained 不复活）；generator base=3(weight4) → 0（重角色门控保留）。

---

### Step 4: 边界 —— drained/offline（effective=0）仍不可派，manual override 语义不回退
**来源**: `[FROM_PRD]` — PRD 边界情况「effective=0 保底规则不得抬成 ≥1」

**可观测行为**: effective_slots=0 的机器，即便 role=proposer 且 `inputs.manual_dispatch=true`，`getMachineCapacity().available === 0`（manualCapacityOverride 要求 effectiveBaseSlots>0，天然不复活）。

**验证命令**（见 DoD B-05 第二段）: 同 B-05。

**硬阈值**: effective=0 + manual_dispatch → available=0。

---

## 禁 mock 边清单

本单属「跨模块数据传递」改动（stats → 容量 → 角色槽），按 v9.12 硬规则逐条列禁 mock 的边（测试只许注入/mock 最外层 os/sysctl/HTTP 边界，禁 mock 被改的内部边）：

- `computeCapacityFromStats` ↔ `calculatePhysicalCapacity`（本单接线容量管道，测试必须调真实 calculatePhysicalCapacity，只注入原始 stats）
- `computeCapacityFromStats` ↔ `macOSPressureLevelToFraction`（本单新增压力口径边，测试必须调真实映射，只注入原始 macPressureLevel 数值）
- `production-probes.getMachineCapacity` ↔ `getRoleCapacity`（本单改角色保底，测试必须调真实 getRoleCapacity，只 mock 最外层 fleet 快照 fetchFn 与 nodeAdmissionClient）

允许 mock 的外层无关边界：`os.cpus()/os.totalmem()`（注入 stats 对象替代）、`sysctl vm.memory_pressure`（注入 macPressureLevel 数值替代）、fleet 快照 HTTP（fetchFn 注入）、nodeAdmissionClient。**无 Postgres 依赖**（runtime_resources.postgres=false，本单不触 DB 写路径）。

> 注：既有 `packages/brain/src/__tests__/fleet-resource-cache.test.js` 用 `vi.mock('../platform-utils.js')` 只提供 calculatePhysicalCapacity。接线 macOSPressureLevelToFraction 后该 mock 需补该导出，属既有测试维护，generator 一并更新（不得因此 mock 掉本单被改的边——新回归测试仍须真调）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | 修复本机 kernel 容量三层失真：①采集口径使 physical 反映真实资源 ②macOS 压力改内核自评等级映射 ③轻角色 effective≥1 保底≥1，消灭 floor 归零死区 |
| **NFR（做得多好）** | | PrepPRD 未指定超时/频控；约束：容量口径可经 capacity-budget API 查询验证；归零死区消除后不得出现「无告警的无限退避」 |
| **Invariant（永不违反）** | | (a) effective=0 机器保底不得复活（drained/offline/Critical 仍不可派）；(b) 重角色(weight4)算力不足门控与 manual override 语义不回退；(c) 远端 Unix 与非 macOS 平台 pressure 路径不受影响 |
| **判定点（怎么知道）** | | 见下方登记表（darwin 压力口径、保底范围） |
| **保质期（何时过期）** | | 容量口径为常驻计算，无过期；sysctl vm.memory_pressure 为内核实时值 |
| **死亡告警（停了谁知道）** | | 归零死区若复发 → proposer/harness 角色 spawn 卡 all_execution_targets_exhausted，controller 可观测（非静默）；capacity-budget API 可随时查 fleet[] 水位 |
| **失败语义（挂了怎么办）** | | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | | 管道级 node 断言（pre-merge，workspace 源码）+ capacity-budget 真机确认（post-deploy，见接缝清单） |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳定 | 静默丢消息 |
| macOS 内存压力真实等级 | A. `(total-free)/total` free% 推断; B. 内核 `vm.memory_pressure` 自评 0-3 映射 | B（映射 0→0/1→0.3/2→0.7/3→1），level=-1 时回退 A | 内核自评是权威信号；free% 在 macOS 缓存语义下长期偏高，恒把 effective 折半（infra-status.js:108-114 教训） | 误判压力偏高 → effective 永久折半 → 算力浪费/归零 |
| ⚠️ 保底适用角色范围 | A. 任何角色 effective≥1 → ≥1（PRD 字面）; B. 仅轻角色 weight≤2 保底，重角色保持门控+manual | B（保守） | 验收 3 只约束 proposer；既有两条 production-probes 测试刻意门控重角色，采 B 零回归 | 若真意是 A 而采 B → 重角色仍需 manual（可接受）；若采 A 而真意是 B → 重角色挤薄机器 overload（面客风险，故标 ⚠️） |

> judgment-pending-user: 保底适用角色范围（轻角色 weight≤2 vs 任何角色）—— PrepPRD/对齐会未拍，本轮采保守轻角色解，待 GAN Reviewer / 主理人确认。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503 不写 DB | 是 | 客户端重试 |
| `getMacOSMemoryPressure()` sysctl 失败/非 darwin（返回 -1） | 不崩溃，回退既有 used_ratio(free%) 路径算 pressure | 是（纯计算，幂等） | 回退 used_ratio，容量仍可算出 |
| `collectLocalStats()` 采集异常 | collectServerStats 既有 catch → online:false, physical/effective=0 | 是 | 该机判 offline 不可派（既有行为不改） |
| effective=0（drained/Critical） | available=0，proposer 亦不可派 | 是 | 不复活，等待水位恢复 |

### 输入对抗面

N/A —— 本 sprint 为 kernel 内部容量计算，无对外暴露 agent / 无外部用户可写输入。

---

## 已知约束（来自回归测试 + 累积 FR）

- [packages/brain/src/orchestrator/fleet-node/node-profile.test.js] → `getRoleCapacity` 对 8 base slots 各角色权重折算：proposer→4/generator→2/planner→8…（保底为 max(1,·)，base=8 时不改这些值）
- [packages/brain/src/orchestrator/preflight/production-probes.test.js] → 「generator/effective=3/weight4 → blocked(all_execution_targets_exhausted)」重角色门控；「evaluator/effective=1/weight4/manual → override available=1」manual 兜底不复活 drained（本轮保守解保留此两条）
- [packages/brain/src/__tests__/fleet-resource-cache.test.js] → 既有用 vi.mock 替 infra-status/platform-utils（接线新导出后需补 mock）
- [累积FR] 本 line 暂无历史（PRD 声明 + context-manifest 无新增）
- [MAP_NOT_CONFIGURED] must_run_assertions：无（map_scope 为 null）

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 为纯容量计算内部改动，**无 DB 依赖**（runtime_resources.postgres=false），故不套用 local_api 模板的 migration/signup 自举——E2E 直接对 workspace 源码跑管道级 node 断言（pre-merge 真验被测新代码）。`capacity-budget` 真机确认属 post-deploy 接缝（见接缝清单），不放进本 pre-merge 硬闸。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}/packages/brain"

# Step 1 — 根因① 管道：mock 本机级 stats(10 核 16384MB, Normal) → physical>=8 且 effective>=4
node --input-type=module -e 'import { computeCapacityFromStats as c } from "./src/fleet-resource-cache.js"; const r = c({ platform: "Darwin arm64", cpu: { cores: 10, usagePercent: 24 }, memory: { totalGB: 16, usedGB: 6, usagePercent: 43 } }, { macPressureLevel: 0 }); if (!(r.physicalCapacity >= 8)) { console.error("FAIL physical", r.physicalCapacity); process.exit(1); } if (!(r.effectiveSlots >= 4)) { console.error("FAIL effective", r.effectiveSlots); process.exit(1); } console.log("OK step1 physical", r.physicalCapacity, "effective", r.effectiveSlots);'

# Step 2 — 根因② 内核压力映射表精确相等
node --input-type=module -e 'import { macOSPressureLevelToFraction as f } from "./src/platform-utils.js"; const e = {0:0,1:0.3,2:0.7,3:1}; for (const k of [0,1,2,3]) { if (f(k) !== e[k]) { console.error("FAIL map", k, f(k)); process.exit(1); } } if (f(9) !== -1) { console.error("FAIL sentinel", f(9)); process.exit(1); } console.log("OK step2 mapping");'

# Step 3 — 根因② 接线：darwin 用内核 level 不用 free%；level=-1 回退 used_ratio 不崩溃
node --input-type=module -e 'import { computeCapacityFromStats as c } from "./src/fleet-resource-cache.js"; const s = { platform: "Darwin arm64", cpu: { cores: 10, usagePercent: 10 }, memory: { totalGB: 16, usedGB: 14, usagePercent: 90 } }; const u = c(s, { macPressureLevel: 2 }); if (Math.abs(u.pressure - 0.7) > 1e-9) { console.error("FAIL kernel pressure", u.pressure); process.exit(1); } const fb = c(s, { macPressureLevel: -1 }); if (Math.abs(fb.pressure - 0.9) > 1e-9) { console.error("FAIL fallback used_ratio", fb.pressure); process.exit(1); } console.log("OK step3 kernel+fallback");'

# Step 4 — 根因③ 轻角色保底 + drained/重角色门控
node --input-type=module -e 'import { getRoleCapacity as g } from "./src/orchestrator/fleet-node/node-profile.js"; if (!(g({ baseCapacity: 1, role: "proposer" }).capacity >= 1)) { console.error("FAIL proposer deadzone"); process.exit(1); } if (g({ baseCapacity: 0, role: "proposer" }).capacity !== 0) { console.error("FAIL drained revived"); process.exit(1); } if (g({ baseCapacity: 3, role: "generator" }).capacity !== 0) { console.error("FAIL heavy gate broken"); process.exit(1); } console.log("OK step4 role floor guard");'

# Step 5 — 金链路观察：effective=1 proposer(no manual) available>=1；effective=0+manual 仍 available=0
node --input-type=module -e 'import { createProductionCapabilityProbes as F } from "./src/orchestrator/preflight/production-probes.js"; const mk = (fleet) => F({ pool: { query: async () => ({ rows: [] }) }, registry: { get: () => {} }, fetchFn: async () => new Response(JSON.stringify({ fleet }), { status: 200, headers: { "content-type": "application/json" } }), env: { CECELIA_MACHINE_ID: "us-mac-m4" }, nodeAdmissionClient: { getAdmission: async () => ({ state: "base_admitted", base_admitted: true, dispatch_ready: true, reasons: [] }) } }); const a = await mk([{ id: "us-mac-m4", online: true, effective_slots: 1, physical_capacity: 8, pressure: 0 }]).getMachineCapacity({ machine: "us-mac-m4", task_bundle: { role: "proposer" } }); if (!(a.available >= 1)) { console.error("FAIL proposer eff1 available", a.available); process.exit(1); } const b = await mk([{ id: "us-mac-m4", online: true, effective_slots: 0, physical_capacity: 0, pressure: 1 }]).getMachineCapacity({ machine: "us-mac-m4", task_bundle: { role: "proposer", inputs: { manual_dispatch: true } } }); if (b.available !== 0) { console.error("FAIL drained revived by manual", b.available); process.exit(1); } console.log("OK step5 available", a.available, "drained", b.available);'

echo "PASS: kernel 容量三层失真 Golden Path 全通过"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `computeCapacityFromStats` 传 `cpu.cores=0` / `memory.totalGB=0` / `memory.totalGB` 小于保留内存（负 usableMem）→ 不得抛异常，physical 落到既有 max(raw,2) 下限、effective≥0
- 错输入: `macOSPressureLevelToFraction` 传浮点 1.5 / 负数 / null → 返回 -1 sentinel，不抛
- 边界值: `getRoleCapacity` base=1 各权重（proposer=2 保底 1；generator=4 门控 0）；base 极大值不越 MAX_PHYSICAL_CAP 语义
- 中途中断: sysctl 超时（getMacOSMemoryPressure 2s timeout）→ 返回 -1 回退，不阻塞采集循环
发现分级: P0/P1（容量误算致归零/误抬 drained）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## 接缝清单（真机/真环境断言，标 logic-done-pending）

| # | 接缝点 | 碰真实世界在哪 | 真目标验证方式 | 状态 |
|---|--------|----------------|----------------|------|
| 1 | 根因① collectLocalStats 真实采集修复 | us-mac-m4 真运行环境的 os.cpus()/totalmem 真实主机资源 | 部署后 `curl localhost:5221/api/brain/capacity-budget \| jq '.fleet[]\|select(.id=="us-mac-m4")'` → physical_capacity≥8 且 effective_slots≥4 | logic-done-pending（pre-merge 无法在非 us-mac-m4 环境确认真实采集；管道数学已由 B-01 覆盖） |
| 2 | 根因② darwin 内核 sysctl vm.memory_pressure | 真机 macOS sysctl 实时等级 | us-mac-m4 上 `sysctl vm.memory_pressure` 与 capacity-budget pressure 对齐 | logic-done-pending（CI/容器为 Linux，getMacOSMemoryPressure 返 -1；映射纯函数已由 B-02 覆盖） |

> 说明：pre-merge 硬闸（B-01..B-05）覆盖全部**环境无关逻辑**（管道数学/映射表/角色保底/金链路 available）；接缝 1/2 的**真实采集生效**须 post-deploy 在 us-mac-m4 经 capacity-budget 确认，故标 logic-done-pending，不得凭 CI 绿标 done。

## 未覆盖真实链路清单

- 接缝 1（collectLocalStats 真实主机采集）：pre-merge 以 mock stats 注入 computeCapacityFromStats 验管道数学，未在真 us-mac-m4 触发真实 os 采集 → 补位：post-deploy capacity-budget 确认（接缝清单 #1）。
- 接缝 2（真机 sysctl 内核压力）：pre-merge 以注入 macPressureLevel 数值验映射，未跑真 sysctl → 补位：post-deploy us-mac-m4 sysctl 对齐（接缝清单 #2）。
- 无 `force_*`/stub 假数据顶替第三方 API（本单无第三方依赖，N/A）。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| computeCapacityFromStats 管道 | `tests/kernel-capacity-distortion.test.ts` | `computeCapacityFromStats 10 核 16384MB physical>=8 effective>=4` | → import 缺失 computeCapacityFromStats，红 |
| macOS 压力映射 | `tests/kernel-capacity-distortion.test.ts` | `macOSPressureLevelToFraction 0 1 2 3 精确映射` | → import 缺失 macOSPressureLevelToFraction，红 |
| darwin 内核压力接线 | `tests/kernel-capacity-distortion.test.ts` | `darwin 用内核 level 不用 free% level -1 回退` | → 缺失函数，红 |
| 角色保底 floor 死区 | `tests/kernel-capacity-distortion.test.ts` | `getRoleCapacity proposer base 1 available >= 1` | → 现值 0，红 |
| 金链路 available | `tests/kernel-capacity-distortion.test.ts` | `getMachineCapacity effective 1 proposer available >= 1` | → 现值 0，红 |

> BEHAVIOR 覆盖名均为 tests/*.test.ts 对应 it() 名的字面子串（下游按字符串匹配回映）。
