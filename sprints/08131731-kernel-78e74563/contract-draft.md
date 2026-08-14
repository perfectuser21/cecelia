# Sprint Contract Draft (Round 1)

**Sprint**: fix(brain) 本机容量三层失真——10核16GB空机被算成 0 个 proposer 槽
**journey_type**: autonomous
**target_environment**: local_api
**锚定父路声明**: 独立小路（无父路）— journey `e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29` 现有 ability 均为 planned（Agent 一键归零重置），本 sprint 为 kernel 容量修复独立小路，无父路步骤可锚。

> gp-anchor: skipped (product-map.json not found) — 本仓库根目录无 `product-map/generated/product-map.json`（cecelia 非 zenithjoy-workspace），GP-Anchor 段整体跳过，不阻塞。
> contract-gate: 适用（`packages/brain/src/lib/contract-gate.js` 存在，cecelia 仓）——本合同断言按 Contract Gate 速查表惯用法书写。
> Unified Map: [MAP_NOT_CONFIGURED] — task.payload 无 map_scope/map_repo，`must_run_assertions` 为空，未回退领域硬编码。

---

## 取证（Proposer 实现阶段先行完成 — 本机 stats 失真直接证据）

在本 attempt 的 fleet-worker 容器内实测（与 us-mac-m4 上 Brain 容器同构，`machine_vitals.vm_total_mb=4988` 佐证 Brain 跑在 cgroup 受限容器内）：

```
os.cpus().length      = 6           # 主机真实 10 核
os.totalmem()         = 5230182400  # ≈4.9GB；主机真实 16GB
calculatePhysicalCapacity(5018, 6, 400, 0.5)   = 2   ← 触发下限兜底 max(raw,2)
calculatePhysicalCapacity(16384,10, 400, 0.5)  = 16  ← 主机真实值
```

生产实测（`curl localhost:5221/api/brain/capacity-budget`）：
```
us-mac-m4  : physical_capacity=2  effective_slots=1  pressure=0.383   ← 本 bug（本机，容器采集）
xian-mac-m4: physical_capacity=16 effective_slots=7  pressure=0.534   ← 正常（SSH 采集主机真实资源）
xian-mac-m1: physical_capacity=12 effective_slots=6  pressure=0.441   ← 正常（SSH 采集主机真实资源）
```

**根因定性**：本机走 `collectLocalStats()`（容器内 `os.*` 看到 cgroup 硬顶 ~5GB/6 核）；远端走 `collectRemoteUnixStats()`（SSH 进主机看到真实资源）。**采集口径不对称**是唯独本机失真的直接原因——正是 Invariant「口径三源失真」的实例（容器口径冒充主机口径）。

---

## Response Schema（推导来源: 现有端点 capacity-budget.js，非新端点）

本 sprint 无新增 HTTP 端点。唯一涉及的 HTTP 面是既有 `GET /api/brain/capacity-budget`（`packages/brain/src/routes/capacity-budget.js`），schema 不变，仅数值随修复回正。真验（VP4）读取其 `fleet[]` 数组：

```json
{ "fleet": [ { "id": "us-mac-m4", "online": true, "effective_slots": <int>, "physical_capacity": <int>, "pressure": <number> } ] }
```
- `fleet[].id` (string)：机器 id，来源——capacity-budget.js `fleet.map` 直取 `s.id`
- `fleet[].physical_capacity` (int)：来源——fleet cache `entry.physicalCapacity`（= `calculatePhysicalCapacity(...)`）
- `fleet[].effective_slots` (int)：来源——fleet cache `entry.effectiveSlots`（= `floor(physical × (1-pressure))`）
- `fleet[].pressure` (number)：来源——fleet cache `entry.pressure`

**禁用字段名**: N/A（复用既有 schema，未新增/重命名任何字段）
**Error**: N/A（本 sprint 不改 `/capacity-budget` 错误路径；其 catch 兜底行为不变）

---

## Golden Path

[容量刷新] → [① 真实主机资源采集] → [② 内核 pressure 等级映射] → [③ effective≥1 角色保底分配] → [proposer 可派]

### Step 1: fleet-resource-cache 刷新本机（us-mac-m4）容量时采集到真实主机资源
**来源**: `[FROM_PRD]` — Golden Path 第 2 步第 1 项 + 预期受影响文件 `infra-status.js: collectLocalStats`

**可观测行为**: `collectLocalStats` 返回的 `cpu.cores` / `memory.totalGB` 反映主机真实资源（10 核 / 16GB），不再是容器 cgroup 视角的 ~6 核 / ~5GB；`calculatePhysicalCapacity` 据此算出 physical ≥ 8（不再触发 `max(raw,2)` 下限兜底）。

**验证命令**:
```bash
cd /workspace/packages/brain && npx vitest run src/__tests__/fleet-local-capacity-fix.test.js -t "① collectLocalStats"
# 期望：exit 0（3 条全过：注入主机资源→cores=10/totalGB≈16；推导 physical≥8；公式回归 ≥8）
```
**硬阈值**: 注入 `{cpuCores:10,totalMemMB:16384}` 时 `calculatePhysicalCapacity ≥ 8`；`stats.cpu.cores === 10`。

---

### Step 2: macOS pressure 改用内核 `vm.memory_pressure` 自评等级映射，darwin free% 路径不再参与
**来源**: `[FROM_PRD]` — Golden Path 第 2 步第 3 项 + 契约映射表 Normal=0/Warning=0.3/Urgent=0.7/Critical=1 + 边界「-1 需明确 fallback，不得静默当 0」

**可观测行为**: 存在纯函数 `resolveMemPressureRatio({platform, kernelLevel, memUsagePercent})`：darwin 且 `kernelLevel∈{0,1,2,3}` → 按映射表返回 `{0,0.3,0.7,1}`（此时 `memUsagePercent`/free% 不参与）；darwin 且 `kernelLevel===-1`（内核读取失败）→ 明确 fallback 到 `memUsagePercent/100`（不静默当 0）；非 darwin → 走既有 `memUsagePercent/100` 路径，行为不变。该函数接入 `collectServerStats` 本机 pressure 计算。

**验证命令**:
```bash
cd /workspace/packages/brain && npx vitest run src/__tests__/fleet-local-capacity-fix.test.js -t "② macOS 内核 pressure"
# 期望：exit 0（映射表 4 档 + free% 不参与 + -1 fallback + 非 darwin 行为不变）
```
**硬阈值**: 映射表 `0→0 / 1→0.3 / 2→0.7 / 3→1`（`toBeCloseTo` 5 位）；`darwin,level=0,usage=90 → 0`；`darwin,level=-1,usage=90 → 0.9`；`linux,usage=50 → 0.5`。

---

### Step 3: effective≥1 时角色分配保底，消灭 floor 归零死区，且 drained/offline(effective=0) 仍不可派
**来源**: `[FROM_PRD]` — Golden Path 第 2 步第 5 项 + 边界「drained/offline effective=0 保底不得抬到 ≥1」

**可观测行为**: `getRoleCapacity({baseCapacity, role})` 保底：`baseCapacity > 0` 时任何角色（含 proposer 权重2、generator 权重4）`capacity ≥ 1`（消灭 `floor(1/2)=0` 死区）；`baseCapacity === 0`（drained/offline）时 `capacity === 0`（不可派语义保留，manual override 语义不回退）；大 base 正常分配不被破坏（如 generator 权重4 base=8 → 2）。

**验证命令**:
```bash
cd /workspace/packages/brain && npx vitest run src/__tests__/fleet-local-capacity-fix.test.js -t "③ 角色分配保底"
# 期望：exit 0（effective=1 proposer≥1；effective=2 generator≥1；base=0 两角色均=0；commander/大base 不受影响）
```
**硬阈值**: `getRoleCapacity({baseCapacity:1,role:'proposer'}).capacity ≥ 1`；`getRoleCapacity({baseCapacity:0,role:'proposer'}).capacity === 0`。

---

### Step 4（出口）: 部署后 us-mac-m4 真实可派 proposer
**来源**: `[FROM_PRD]` — Golden Path 第 3 步可观测结果 + 验收点 4（真验）

**可观测行为**: 修复部署到本机 Brain 后，`curl /api/brain/capacity-budget` 中 us-mac-m4 的 `physical_capacity ≥ 8` 且 `effective_slots ≥ 4`（当前空载水位），online=true；drained/offline 机器（若有）`effective_slots=0` 不变。

**验证命令**:
```bash
curl -sf -m 10 localhost:5221/api/brain/capacity-budget | jq -e '.fleet[] | select(.id=="us-mac-m4") | (.online==true and .physical_capacity>=8 and .effective_slots>=4)'
# 期望：exit 0（部署后真验；未部署前此断言 FAIL 属预期，evaluator 在 merge+deploy 后 final-e2e 执行）
```
**硬阈值**: us-mac-m4 `physical_capacity ≥ 8` 且 `effective_slots ≥ 4` 且 `online==true`。

---

## 禁 mock 边清单

本单改动涉及**跨模块数据传递**（采集→容量计算→角色分配）与**调度决策**（可派/不可派），failing test 必须不 mock 被改的那条边：

- **collectLocalStats（infra-status.js） ↔ calculatePhysicalCapacity（platform-utils.js）**：本单改了本机采集口径与其下游 physical 计算，测试真调 `collectLocalStats` 本体与真实 `calculatePhysicalCapacity`，只注入最外层 `hostResources` 输入，**禁 mock/vi.mock 这两函数**。
- **resolveMemPressureRatio（platform-utils.js） ↔ collectServerStats pressure 计算（fleet-resource-cache.js）**：本单新增 pressure 映射并接入 effective 计算链，测试真调 `resolveMemPressureRatio` 本体，只注入 `kernelLevel`/`memUsagePercent`，**禁 mock 该映射函数**。
- **getRoleCapacity（node-profile.js） ↔ 角色分配消费方（production-probes.js getMachineCapacity）**：保底逻辑落在 `getRoleCapacity`，测试真调 `getRoleCapacity` 本体断言保底与 drained=0 语义，**禁 mock getRoleCapacity**。

> 说明：既有 `fleet-resource-cache.test.js` 对 `platform-utils`/`infra-status` 的 `vi.mock` 属于**其它行为**的存量测试，本 sprint 新增的 `fleet-local-capacity-fix.test.js` 不得 mock 上述被改的边（已机检：本文件无 `vi.mock`/`stub`）。

---

## Response Schema（推导段结束）

---

## 已知约束（回归测试 + 累积 FR + 铁律）

**回归测试约束（Step 1.2，`fleet-resource-cache.test.js` / `node-profile.test.js`）**：
- [fleet-resource-cache] `getFleetStatus` 未启动返回空数组 / 启动后返回 3 台机器 / `getTotalEffectiveSlots` 返回正数 / 数据过期后 `isServerOnline` 返回 false —— 本改动不得破坏这些结构。
- [node-profile] registry 恰含三台 canonical 机器且 capacity 冻结 / `getRoleCapacity` 为角色权重容量计算器 / 未知角色 throw `unknown_fleet_role` —— 保底改动不得改变 throw 语义与权重表。

**累积 FR（Step 1.3，`[累积FR]`）**：context-manifest: unavailable（endpoint 未取回；PRD 声明本 line 暂无历史已验收行为，journey e6f803f2 现有 ability 均 planned）。

**铁律（Invariant，来自 PRD）**：
- INV-1 [口径三源失真]：指标/容量口径类告警先查口径三源失真（未接线恒空子指标、守卫自产回流自噬、双重计数）再当真实退化处理。→ 本 sprint 修的正是「容器口径冒充主机口径」的口径失真；DoD INV-1 断言修复后本机口径反映主机真实资源（见 B-01），不再产生假容量退化。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 本机容量采集真实化 + macOS 内核 pressure 映射 + effective≥1 角色分配保底 |
| **NFR（做得多好）** | 性能/并发阈值 | 待定（PrepPRD 未指定超时/频控）；pressure/采集为 30s 刷新链上纯计算，无新增 IO 热路径 |
| **Invariant（永不违反）** | 不变量 | ① drained/offline(effective=0) 恒不可派（保底不得抬到≥1）；② 非 darwin 机器 pressure 行为不变；③ physical 硬顶 MAX_PHYSICAL_CAP=20 不被突破；④ 口径三源失真（INV-1） |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方判定点登记表 |
| **保质期（何时过期）** | 何时失效 | 无 token/凭据；映射表为本 sprint 契约值，如后续 macOS 内核语义变更需同步 |
| **死亡告警（停了谁知道）** | 告警手段 | 可观测留痕（NFR）：online 机器 effective 归零 / physical 触发下限兜底 时应 warn 日志留痕，不得静默无限退避（根因③放大器） |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执方式 | VP4 真验：部署后 `curl capacity-budget` 读回 us-mac-m4 physical≥8/effective≥4 作为生效回执 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 | A | 记录 API 不稳 | 静默丢消息 |
| ⚠️ 本机真实内存压力判定 | A. free%（`os.freemem`/`memory_pressure` free 百分比）; B. 内核自评 `vm.memory_pressure` 0-3 级 | B（darwin），A（非 darwin） | macOS 缓存天然吃满内存，free% 恒 0.3-0.4 导致 effective 永久折半（本 bug 根因②）；内核自评是权威信号 | 误判为高压 → effective 折半/归零 → proposer 不可派（本 bug）；误判为低压 → 过派 OOM |
| ⚠️ 本机真实硬件容量判定 | A. 容器内 `os.totalmem`/`os.cpus`; B. 主机真实资源（env 注入/主机采集） | B | 容器 cgroup 硬顶使 `os.*` 只见 ~5GB/6核，冒充主机 16GB/10核（本 bug 根因①） | 误判为小机 → physical 触底兜底 2 → 算力假性归零（本 bug） |

> ⚠️ 两个判定点误判后果严重（算力假性归零 / 过派 OOM），属「升拍板点」级别。judgment-pending-user: 内核等级→pressure 映射表 `Normal=0/Warning=0.3/Urgent=0.7/Critical=1`（PRD 假设为契约值，未经主理人拍板；如需调整由主理人定）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503 | 是 | 客户端重试 |
| macOS 内核 pressure 读取失败(-1) | 明确 fallback 到 free%/usagePercent 路径（**不静默当 0**） | 是（纯计算，每次刷新重算） | 保守用 usagePercent，宁可少派不过派 |
| 本机主机资源解析失败 | fallback 到容器 `os.*`（保守偏小，不过派）；并保留 physical 下限兜底 | 是（每 30s 刷新重算） | 偏保守，最坏退回当前行为，不引入过派 |
| 采集异常（catch 分支） | 机器标 offline、physical/effective=0（既有行为不变） | 是 | 不可派，等下次刷新恢复 |

### 输入对抗面

N/A —— 本 sprint 为 Brain 内部 fleet 容量计算，无对外暴露 agent / 无外部用户可写入接口 / 无爬虫内容入 pipeline。

---

## E2E 验收（final-e2e — target_environment=local_api）

> 本段为 evaluator 模式 B final-e2e 脚本（按顺序拼接执行）。核心逻辑层由 vitest 单测覆盖（B-01~B-03，环境无关，`postgres:false` 亦可跑）；接缝层真验由 VP4 curl 完成（依赖 merge+deploy 后的本机 Brain）。

```bash
#!/bin/bash
set -euo pipefail

REPO_ROOT="${WORKSPACE_PATH:-/workspace}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

# ── 逻辑断言（环境无关，CI/单测层）：三层根因回归全过 ──
cd "$REPO_ROOT/packages/brain"
NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/__tests__/fleet-local-capacity-fix.test.js --reporter=basic
echo "✅ 逻辑层：本机容量三层修复单测全过（① 采集真实化 / ② 内核 pressure 映射 / ③ 角色保底）"

# ── 接缝断言（真目标，local_api 真验）：部署后 us-mac-m4 容量回正 ──
# 说明：此断言在 fix 部署到本机 Brain 后为真；evaluator 在 merge+deploy 后执行 final-e2e。
RESP=$(curl -sf -m 10 "${BRAIN_URL}/api/brain/capacity-budget")
echo "$RESP" | jq -e '.fleet[] | select(.id=="us-mac-m4") | (.online==true and .physical_capacity>=8 and .effective_slots>=4)' \
  || { echo "FAIL: us-mac-m4 未回正（physical≥8 且 effective≥4）——检查修复是否已部署到本机 Brain"; exit 1; }
echo "✅ 接缝层：us-mac-m4 physical≥8 且 effective≥4，proposer 真实可派"

echo "✅ Golden Path 验证通过"
```

**接缝清单（1-3 条，未真验标 logic-done-pending）**：
1. `us-mac-m4 容量回正`（真目标：本机 Brain `/api/brain/capacity-budget`）——真目标验证方式：merge+deploy 后 curl 读回 physical≥8/effective≥4。**部署前状态：logic-done-pending**（逻辑层单测已可绿，接缝真值待部署）。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `resolveMemPressureRatio` 传非法 `kernelLevel`（如 4 / null / NaN / 字符串）→ 应有确定行为（fallback 到 usagePercent 或明确边界），不得 NaN 污染 pressure。
- 边界值: `getRoleCapacity` base=0 各角色（commander/planner/reviewer/proposer/generator/evaluator/judge/reporter）逐一确认恒 0；base=1 各角色恒 ≥1；未知角色仍 throw `unknown_fleet_role`。
- 中途中断: `collectLocalStats` 主机资源解析源缺失（env 未注入 / 主机采集失败）→ 应 fallback 到容器 `os.*` 保守值，不抛未捕获异常使整条刷新链崩。
- 重复提交: 连续两次 refresh，本机 physical/effective 稳定（不因内核 pressure 抖动在 0/满之间振荡）。
发现分级: P0/P1（drained 被误抬为可派 / 过派 OOM / 刷新链崩）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

---

## staging 预览闸

N/A —— journey_type=autonomous，享零回归保护，不纳入预览闸范围（预览闸仅 user_facing 强制）。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 三层根因修复 | `packages/brain/src/__tests__/fleet-local-capacity-fix.test.js`（永久 CI）+ `sprints/08131731-kernel-78e74563/tests/fleet-local-capacity-fix.test.js`（红证据镜像） | `collectLocalStats 反映真实资源` / `推导 physical ≥ 8` / `darwin 内核等级` / `fallback 到 usagePercent` / `proposer(权重2) available ≥ 1` / `capacity=0（manual override 语义不回退）` | 11 failed / 5 passed（本轮实测：cores 6≠10、physical 2<8、`resolveMemPressureRatio is not a function`、`floor(1/2)=0<1`） |
