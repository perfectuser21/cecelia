# Sprint Contract Draft (Round 1) — 本机容量三层失真修复

**journey_type**: autonomous
**target_environment**: local_api
**锚定父路声明**: 独立小路（无父路）—— 修复 kernel 容量核算逻辑，PrepPRD 未锚定 golden-path step（journey_id e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29 / step_id none）。

gp-anchor: skipped (product-map.json not found)
contract-gate: 本仓存在 packages/brain/src/lib/contract-gate.js（cecelia worktree），代码层 Contract Gate 生效，断言按速查表惯用法书写。

---

## Unified Map 半径

[MAP_NOT_CONFIGURED] — task.payload.map_scope / map_repo 均为 null（已查 `curl localhost:5221/api/brain/tasks/$TASK_ID`），无 must_run_assertions 注入；不回退领域硬编码，回归约束以下方"已知约束"章节的仓库现存单测为准。

---

## 取证结论（层① 根因，先取证后修法 — PRD 假设已验证）

在本 attempt 执行环境实跑 `collectLocalStats()`：返回 `cpu.cores=6`、`memory.totalGB≈4.9`（totalMemMB≈5018）。代入 `calculatePhysicalCapacity(5018, 6, 400, 0.5)`：
- usableMem = (5018 − 5000)×0.8 = 14.4，/400 = 0.036
- usableCpu = 6×0.8 = 4.8，/0.5 = 9.6
- raw = floor(min(0.036, 9.6)) = 0 → `Math.min(Math.max(0, 2), 20)` = **2**（命中下限兜底）

对照真实 16GB/10核：`calculatePhysicalCapacity(16384, 10, 400, 0.5)` = **16**（≥8，公式本身正确）。

**live 佐证**：`curl localhost:5221/api/brain/capacity-budget` 当前实测 us-mac-m4 `physical_capacity=2 / effective_slots=1`，而 xian-mac-m4=16/7、xian-mac-m1=12/6（同公式）。

→ 取证结论：层① 的直接成因是**本机 `collectLocalStats` 返回失真的 totalMem/cpuCores**（进程可见资源约 5GB/6核，非宿主 10核16GB），使 physical 命中 `Math.max(raw, 2)` 下限。修法：`collectLocalStats` 采集本机容量时须反映**宿主物理资源**（darwin: `sysctl -n hw.memsize` / `hw.ncpu`；其他: 宿主 MemTotal / nproc），下限兜底 2 保留但不再被采集失真触发。此层真机红证据见 DoD **B-06**（部署后 curl 真验，当前 live 为红）。

---

## Response Schema（推导来源: PRD 明确 + api_registry 现有端点 capacity-budget）

### Endpoint: GET /api/brain/capacity-budget（真验入口，本 sprint 不改 schema，只改喂给它的容量数值）
**Success (HTTP 200)** 片段（fleet 数组每项，字段名沿用现网 `capacity-budget.js` 现有输出，禁改名）:
```json
{"fleet": [{"id": "us-mac-m4", "online": true, "physical_capacity": 8, "effective_slots": 4, "pressure": 0.46}]}
```
- `physical_capacity` (number, 必填): 来源——api_registry 现有 capacity-budget 端点字段（字面沿用，禁改成 `physical`/`physicalCapacity`）
- `effective_slots` (number, 必填): 来源——同上（禁改成 `effective`/`effectiveSlots`）
- `pressure` (number, 必填): 来源——同上
- `id` / `online`: 同上
**禁用字段名**: `physical` / `physicalCapacity` / `effective` / `effectiveSlots`（现网 capacity-budget 路由用 snake_case，不得漂移）
**Error**: 本 sprint 不新增/不改错误路径（capacity-budget 现有 500 分支不动）。

内部纯函数契约（本 sprint 真正改动面）:
- `getRoleCapacity({baseCapacity, role})` → `{role, weight, capacity}`（字段名沿用现有）
- `macPressureLevelToRatio(level: 0|1|2|3|-1)` → `number|null`（**新增**，[NEW_PATTERN] 纯映射辅助）

---

## 已知约束（来自回归测试）

- [packages/brain/src/orchestrator/fleet-node/node-profile.test.js] → `applies the %s role weight %i to eight base slots`（proposer 权重 2、baseCapacity=8 → capacity=4，本 sprint 保底修改**不得**破坏此断言）
- [packages/brain/src/orchestrator/fleet-node/node-profile.test.js] → `fails closed for unknown, empty, and non-string roles`（未知角色仍抛 `unknown_fleet_role`）
- [packages/brain/src/orchestrator/fleet-node/node-profile.test.js] → 三机 canonical capacity（us-mac-m4=7 / xian-mac-m4=8 / xian-mac-m1=8）不变
- [packages/brain/src/orchestrator/preflight/production-probes.test.js] → `manual_capacity_override` 语义（physical_capacity 兜 1、drained/offline 不复活）
- [累积FR] 本 line 暂无历史（context-manifest 未注入新 FR）

---

## Golden Path

[kernel 周期采集本机容量] → [真实 stats → 正确 physical] → [darwin 内核 pressure 映射] → [角色折算保底非零] → [proposer 有可用槽，spawn 不再耗尽]

### Step 1: 本机容量采集反映宿主真实资源
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1-2 步、预期受影响文件 `collectLocalStats`。

**可观测行为**: `collectLocalStats` 喂入 `calculatePhysicalCapacity` 的 totalMem/cpuCores 反映宿主物理资源，真实 16GB/10核 → physical ≥ 8，不再命中下限兜底 2。

**验证命令**:
```bash
# 公式守卫（真 stats 不命中兜底）
node --input-type=module -e "import { calculatePhysicalCapacity as f } from './packages/brain/src/platform-utils.js'; process.exit(f(16384,10,400,0.5)>=8?0:1)"
# 真机接缝（部署后）
curl -sf -m 10 localhost:5221/api/brain/capacity-budget | jq -e '.fleet[] | select(.id=="us-mac-m4") | select(.physical_capacity>=8)'
```
**硬阈值**: `calculatePhysicalCapacity(16384,10,400,0.5)` ≥ 8；部署后 us-mac-m4 `physical_capacity` ≥ 8。

---

### Step 2: macOS pressure 改用内核自评等级映射
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步 + 预期受影响文件 `platform-utils.js`（`getMacOSMemoryPressure` 已存在但未接线）。

**可观测行为**: 新增纯映射 `macPressureLevelToRatio`：内核自评 0→0 / 1→0.3 / 2→0.7 / 3→1；`fleet-resource-cache` 采集本机（darwin）内存压力时改走 `getMacOSMemoryPressure()` → 映射值，仅当内核不可用（-1，映射返回 null）时回退既有 `memory.usagePercent/100`（used_ratio）路径。非 darwin 路径不变。

**验证命令**:
```bash
node --input-type=module -e "import { macPressureLevelToRatio as m } from './packages/brain/src/platform-utils.js'; const ok=m(0)===0&&Math.abs(m(1)-0.3)<1e-9&&Math.abs(m(2)-0.7)<1e-9&&m(3)===1&&m(-1)===null; process.exit(ok?0:1)"
```
**硬阈值**: 映射四点精确匹配；level=-1/非法 → null（触发 used_ratio 回退，darwin 上 free% 仅此时参与）。

---

### Step 3: 角色权重折算保底，消灭 floor 归零死区
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步 + 根因③。**修法定位为取证补充**：PRD 预期受影响文件把保底写在 `fleet-resource-cache.js`，但真正的角色权重折算是 `node-profile.js:getRoleCapacity` 的 `Math.floor(baseCapacity/weight)`（`production-probes.js:getMachineCapacity` 消费），死区在此，故保底改在 `getRoleCapacity`。

**可观测行为**: `getRoleCapacity({baseCapacity, role})`：`baseCapacity===0` → `capacity=0`（不可派，不回退）；`baseCapacity≥1` → `capacity=Math.max(1, Math.floor(baseCapacity/weight))`（effective≥1 时任何角色至少 1 槽）。proposer(权重2) baseCapacity=1 从 0 变 1。

**验证命令**:
```bash
node --input-type=module -e "import { getRoleCapacity as g } from './packages/brain/src/orchestrator/fleet-node/node-profile.js'; const a=g({baseCapacity:1,role:'proposer'}).capacity>=1; const b=g({baseCapacity:0,role:'proposer'}).capacity===0; const c=g({baseCapacity:8,role:'proposer'}).capacity===4; process.exit(a&&b&&c?0:1)"
```
**硬阈值**: `{1,proposer}.capacity` ≥ 1；`{0,proposer}.capacity` = 0（不变量）；`{8,proposer}.capacity` = 4（回归守卫）。

---

### Step 4: 出口 — proposer 有可用槽，spawn 不再耗尽
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步。

**可观测行为**: 部署后 `curl capacity-budget` us-mac-m4 `physical_capacity` ≥ 8 且 `effective_slots` ≥ 4（空载水位）；层③ 保底使 `getMachineCapacity` 对 proposer 返回 available ≥ 1，无需 manual override 兜底。

**验证命令**:
```bash
curl -sf -m 10 localhost:5221/api/brain/capacity-budget | jq -e '.fleet[] | select(.id=="us-mac-m4") | select(.physical_capacity>=8 and .effective_slots>=4)'
```
**硬阈值**: us-mac-m4 physical ≥ 8 且 effective ≥ 4。

---

## 禁 mock 边清单

本单改动涉及「跨模块数据传递」（`fleet-resource-cache` 采集 → `calculatePhysicalCapacity`/`getMacOSMemoryPressure`）与「角色折算消费链」（`node-profile.getRoleCapacity` ↔ `production-probes.getMachineCapacity`），failing test 必须真调被改的纯函数，不 mock：

- `platform-utils.calculatePhysicalCapacity` / `macPressureLevelToRatio` — 单测真调本函数（纯函数，无外部依赖），禁 stub。
- `node-profile.getRoleCapacity` — 单测真调本函数（读真实 canonical registry JSON），禁 mock registry / 禁 stub 返回值。
- 层① 采集 ↔ 宿主资源接缝（`collectLocalStats` 读 os/sysctl）：**不在单测 mock**，由 B-06 部署后真机 curl 真验（DB/服务端真实值）。

> 说明：`getMacOSMemoryPressure` 内部 `sysctl`（darwin execSync）属"被改的边的更外层系统调用"，非本单被改的模块间数据边；且 CI 跑在非 darwin，darwin 分支的真机验证归 B-06 接缝。映射决策 `macPressureLevelToRatio` 是纯函数，单测真调不 mock。

---

## 真实调用方请求 shape

N/A — 本 sprint 无"设备/agent 调服务端"入口。真验入口 `GET /api/brain/capacity-budget` 是内部只读端点，无外部调用方认证/字段 shape 需对齐。

---

## 未覆盖真实链路清单

- **层① 采集侧真机验证（B-06 接缝）**：本机 `collectLocalStats` 是否在宿主上返回真实 16GB/10核，只能在**部署到 us-mac-m4 的 Brain 进程**上由 `curl capacity-budget` 真验（当前 live 为红：physical=2）。CI（非目标宿主）无法复现宿主资源，故此层单测仅为「真 stats → 公式产 ≥8」的守卫（logic-done），真 done 由 B-06 部署后 curl 判定。补位计划：generator 交付后，evaluator 在 target_environment=local_api（us-mac-m4 本机）跑 `## E2E 验收` 的 curl 段。
- **风险登记**：若取证在实现阶段发现宿主确实仅向 Brain 进程暴露 ~5GB/6核（部署/容器约束而非采集代码 bug），则代码侧读 `hw.memsize` 亦无法凑够 physical≥8——此为部署边界，须回报为 sprint 阻塞（PRD 假设已声明「以取证结果为准」），不得为凑绿伪造 stats。
- 无其他 `force_*`/stub/假数据。层②③ 全部真调纯函数，无 mock 豁免。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | ① 本机采集反映宿主真实资源（physical≥8）；② darwin pressure 用内核自评映射；③ effective≥1 时角色折算保底非零 |
| **NFR（做得多好）** | | 采集链不因 `getMacOSMemoryPressure` 的 2s sysctl 超时阻塞（既有超时保留）；pressure=-1 优雅回退不抛错 |
| **Invariant（永不违反）** | | [manual不回退] effective=0（drained/offline）机器保底不复活其不可派语义；[单slot串行] 不受本单影响 |
| **判定点（怎么知道）** | | 见判定点登记表 |
| **保质期（何时过期）** | | 容量数据每 30s 刷新（REFRESH_INTERVAL_MS）；stale 90s 降级 offline，既有逻辑不改 |
| **死亡告警（停了谁知道）** | | 根因③"角色 effective 归零 → 无限退避无告警"死区由保底消除；保底后 proposer 恒可派 ≥1，spawn 不再静默 `all_execution_targets_exhausted` |
| **失败语义（挂了怎么办）** | | 见失败语义声明 |
| **效果确认（已发≠已生效）** | | B-06 部署后 curl capacity-budget 回执 physical≥8/effective≥4 即真生效；拿不到 200 或数值未达标 = 未生效 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ 本机内存压力等级 | A. free%/used_ratio 反推; B. 内核自评 vm.memory_pressure | B. 内核自评（darwin），A 作 -1 回退 | macOS 缓存吃满内存使 free% 恒高压，内核自评是权威信号 | 误判高压 → effective 永久折半 → 派不出槽（本 sprint 根因②） |
| 宿主真实物理资源 | A. os.totalmem/os.cpus(可被进程约束污染); B. sysctl hw.memsize/hw.ncpu(宿主物理) | B（darwin）/ 宿主 MemTotal（其他） | os.* 在受限进程视图下失真（取证实测 ~5GB/6核） | 低估容量 → physical 命中兜底 2 → 归零死区（根因①） |
| effective=0 是否可派 | A. 仅看 effective 数值; B. effective=0 一律不可派 | B | drained/offline/manual override 语义不得被保底覆盖 | 复活不可派机器 → 派到死机（违反 [manual不回退] 铁律） |

> ⚠️ 行为「升拍板点」级：内存压力判定误判后果面向调度全局；PrepPRD 已按 PRD Golden Path 第 3 步明确内核映射表数值（0/0.3/0.7/1），无需再请示。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `getMacOSMemoryPressure` sysctl 超时/解析失败 | 返回 -1 | 是（纯读） | `macPressureLevelToRatio(-1)=null` → 回退 used_ratio 路径，不抛错阻断采集 |
| `collectLocalStats` 宿主 stats 读取异常 | 既有 catch 分支写 offline/physical=0 | 是 | 沿用现有 offline_reason 逻辑，本单不改 |
| `getRoleCapacity` 非法 baseCapacity/role | 抛 `unknown_fleet_role`/`invalid_fleet_capacity` | N/A | fail-closed，既有行为不变 |

### 输入对抗面

N/A — 无对外暴露 agent；capacity-budget 为内部只读端点，无外部可写输入。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `getRoleCapacity({baseCapacity:-1, role:'proposer'})` / `macPressureLevelToRatio(2.5)` / `macPressureLevelToRatio(null)` → 应 fail-closed 或返回 null，不得返回伪造正数
- 重复提交: 连续两次 curl capacity-budget（间隔 <30s 刷新窗）→ physical 应稳定（cache），effective 允许随 pressure 微动但不应从 ≥4 掉回 0
- 中途中断: pressure 恰在边界（physical=8、pressure≈0.5）时 effective 是否在 3/4 抖动 → 记 findings（边界水位，非 P0）
- 边界值: `getRoleCapacity({baseCapacity:0})` 各角色恒 0；`baseCapacity` 恰等于 weight（proposer=2）→ capacity=1
发现分级: P0/P1（保底复活了 offline 机器 / physical 伪造）→ 阻塞 merge；P2/P3（effective 边界抖动）→ 记 findings 不阻塞

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api，无 DB 依赖）

> 本 sprint 为纯 kernel 容量核算逻辑：无业务表、无 signup/login、无 DB_URL 依赖（runtime_resources.postgres=false 一致）。E2E = 逻辑层纯函数单测 + 层① 真机接缝 curl。evaluator 按 local_api 在 us-mac-m4 本机执行。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"
SPRINT_DIR="sprints/08131731-kernel-78e74563"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

# 1. 逻辑层：三层单测全绿（纯函数，无 DB/无服务端依赖）
npx vitest run "${SPRINT_DIR}/tests/" --reporter=basic

# 2. 层三 保底：proposer 权重2、effective=1 时 available>=1（floor 归零死区消灭）
node --input-type=module -e "import { getRoleCapacity as g } from './packages/brain/src/orchestrator/fleet-node/node-profile.js'; const c=g({baseCapacity:1,role:'proposer'}).capacity; if(c<1){console.error('FAIL layer3 death-zone capacity='+c);process.exit(1)} console.log('OK layer3 available='+c)"

# 3. 层三 不变量：effective=0 仍不可派（manual 不回退）
node --input-type=module -e "import { getRoleCapacity as g } from './packages/brain/src/orchestrator/fleet-node/node-profile.js'; const c=g({baseCapacity:0,role:'proposer'}).capacity; if(c!==0){console.error('FAIL invariant capacity='+c);process.exit(1)} console.log('OK layer3 invariant capacity=0')"

# 4. 层二 pressure 映射：0/1/2/3 -> 0/0.3/0.7/1，-1 -> null
node --input-type=module -e "import { macPressureLevelToRatio as m } from './packages/brain/src/platform-utils.js'; const ok=m(0)===0&&Math.abs(m(1)-0.3)<1e-9&&Math.abs(m(2)-0.7)<1e-9&&m(3)===1&&m(-1)===null; if(!ok){console.error('FAIL layer2 mapping');process.exit(1)} console.log('OK layer2 mapping')"

# 5. 层一 真机接缝：部署后 curl capacity-budget，us-mac-m4 physical>=8 且 effective>=4
RESP=$(curl -sf -m 10 "${BRAIN_URL}/api/brain/capacity-budget")
echo "$RESP" | jq -e '.fleet[] | select(.id=="us-mac-m4") | select(.physical_capacity>=8 and .effective_slots>=4)' >/dev/null || { echo "FAIL layer1 us-mac-m4 physical/effective below target"; echo "$RESP" | jq -c '.fleet[] | select(.id=="us-mac-m4")'; exit 1; }

echo "PASS: 三层修复 + us-mac-m4 physical>=8 effective>=4"
```

**通过标准**: 脚本 exit 0（vitest 全绿 + 三层纯函数断言 + us-mac-m4 physical≥8/effective≥4）。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 层③ 保底 | `tests/capacity-slots.test.ts` | `baseCapacity=1 返回 capacity>=1` | proposer/generator 现返回 0 → 2 failures |
| 层② 映射 | `tests/capacity-slots.test.ts` | `映射表 0→0 / 1→0.3 / 2→0.7 / 3→1` | `macPressureLevelToRatio is not a function` → 2 failures |
| 层① 守卫 | `tests/capacity-slots.test.ts` | `calculatePhysicalCapacity(16384,10,400,0.5) 返回 >=8` | 守卫（现绿=16，证公式正确）；层① 红证据在 B-06 curl |

> RED 实证（本 attempt 已跑）：`npx vitest run sprints/08131731-kernel-78e74563/tests/` → 4 failed（层② ×2 + 层③ ×2）| 3 passed（守卫）。B-06 curl 当前 live 为红（us-mac-m4 physical=2）。
