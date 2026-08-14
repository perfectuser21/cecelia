# Sprint PRD — 本机容量三层失真修复：10核16GB空机不再被算成 0 个 proposer 槽

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消灭本机 kernel 容量归零死区，算力真实可派）

## 背景

us-mac-m4（10核16GB，load 2.4，内存 free 57%）的 kernel 容量被算成 physical=2 / effective=1，
proposer（权重2）得 floor(1/2)=0，spawn 卡 all_execution_targets_exhausted 25 分钟（run 8783807c 实证，
靠 manually_dispatched 豁免才通过）。三层根因叠加：① 本机 stats 采集失真使 physical 触底兜底 2；
② macOS 缓存天然吃满内存，free% 推断的 pressure 恒 0.3-0.4 使 effective 永久折半；
③ 角色权重 2 + effective=1 → floor 归零，且无告警只有无限退避。本 sprint 一次性修掉三层。

## Golden Path（核心场景）

系统从 [容量刷新] → 经过 [真实采集 + 内核压力 + 保底分配] → 到达 [proposer 可派]

具体：
1. 触发条件：fleet-resource-cache 刷新 us-mac-m4（本机，真实 10 核 / 16GB / 空载水位）容量。
2. 系统处理：
   - `collectLocalStats` 采集到反映真实资源的 totalMemMB / cpuCores（不再触发 physical 下限兜底 2）；
   - `calculatePhysicalCapacity` 据真实值算出 physical ≥ 8；
   - macOS 上 pressure 改用内核 `vm.memory_pressure` 自评等级映射（Normal=0 / Warning=0.3 / Urgent=0.7 / Critical=1），
     不再用 free% 推断（darwin 上 free% 路径不再参与 pressure 计算）；
   - `effective = floor(physical × (1 - pressure))`，空载水位下 effective ≥ 4；
   - 角色分配保底：effective ≥ 1 时任何角色（含 proposer 权重 2）至少可派 1 个，消灭 floor 归零死区。
3. 可观测结果：`curl capacity-budget` 显示 us-mac-m4 physical ≥ 8 且 effective ≥ 4，proposer available ≥ 1；
   而 drained / offline（effective=0）机器仍不可派（manual override 语义不回退）。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- drained / offline 机器 effective=0：保底逻辑**不得**把它抬到 ≥1，仍必须不可派（否则 manual override 语义回退）。
- `getMacOSMemoryPressure` 命令失败返回 -1：需有明确 fallback（不得静默当成 pressure=0 造成过派）。
- 非 darwin（Linux 远端机）：pressure 走既有 free%/load 路径，本次改动不得影响其行为。
- physical 硬顶 MAX_PHYSICAL_CAP=20 与下限逻辑：修采集后下限兜底不应再对本机生效。

## 范围限定

**在范围内**：
- 本机 stats 采集真实化（`collectLocalStats`）；
- macOS pressure 改用内核 `vm.memory_pressure` 等级映射，接入 fleet effective 计算链；
- effective≥1 时角色分配保底（消灭 floor 归零死区），保留 drained/offline 不可派语义。

**不在范围内**：
- 远端 Unix 机器采集路径（`collectRemoteUnixStats`）的重构；
- 角色权重体系本身的重新设计；
- capacity.js 备用路径的改写（除非与本修复直接冲突）。

## 假设

- [ASSUMPTION: thin_prd 为空，本 PRD 以 task.description 为产品法律锚定 scope；scope 由 description 内显式文件/行号/验收项充分锚定，故 status=DONE 而非 NEEDS_CONTEXT。]
- [ASSUMPTION: 本机 stats 失真的直接取证（collectLocalStats 实际返回值）在 Proposer/实现阶段先行完成，PRD 只框定"physical 须反映真实资源"这一可观察结果。]
- [ASSUMPTION: 内核等级→pressure 映射表 Normal=0/Warning=0.3/Urgent=0.7/Critical=1 为本 sprint 契约值。]

## 预期受影响文件

- `packages/brain/src/routes/infra-status.js`：`collectLocalStats` 本机采集，使 totalMemMB/cpuCores 反映真实资源。
- `packages/brain/src/platform-utils.js`：`getMacOSMemoryPressure`（已存在，内核 vm.memory_pressure 0-3）接入 pressure 映射。
- `packages/brain/src/fleet-resource-cache.js`：`effective` 计算改用内核 pressure，加 effective≥1 角色保底。
- 对应单测/回归测试文件：先写 failing test（见 E2E 验收）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本 task ability_id 为空，无 step/feature 级 NFR 命中）；PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: effective 归零 / 容量触底兜底时必须留痕（根因③"无告警只有无限退避"是本 bug 的放大器；失败应可观测，不得静默无限退避）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（本 task ability_id 为空，无 step/journey_feature 级命中）；仅注入与本 sprint 口径相关铁律，其余 area 级 harness-pipeline 学习条目从略 -->
- [口径三源失真] 指标/容量口径类告警先查口径三源失真（未接线恒空子指标、守卫自产回流自噬、双重计数）再当真实退化处理（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）
<!-- journey e6f803f2 现有 ability 均为 planned（Agent 一键归零重置），无 done/working 已验收行为 -->

## E2E 验收

> Planner 初稿此区块留占位 + 期望验收点自然语言描述；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填 curl+psql/vitest。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（vitest 单测/回归 + curl localhost:5221 capacity-budget 真验）
# 期望验收点（自然语言）：
# 1. 单测：mock 本机级 stats（10核 / 16384MB）→ calculatePhysicalCapacity ≥ 8。
# 2. 单测：macOS pressure 映射表（内核自评 0→0 / 1→0.3 / 2→0.7 / 3→1），darwin 上 free% 路径不再参与 pressure。
# 3. 回归（永久保留）：effective_slots=1 时 proposer(权重2) 的 available ≥ 1（floor 归零死区消灭）；
#    且 drained/offline（effective=0）机器仍不可派（manual override 语义不回退）。
# 4. 真验：部署后 curl localhost:5221 capacity-budget，us-mac-m4 physical ≥ 8 且 effective ≥ 4（当前空载水位）。
```

## journey_type: autonomous
## journey_type_reason: 改动全在 packages/brain/（fleet 容量调度/决策纯后端），无 UI、无远端 agent 协议、无 engine hooks。
## target_environment: local_api
## target_environment_reason: Brain 内部纯后端，E2E 走本地 evaluator（vitest 单测 + curl localhost:5221 capacity-budget + 必要时 psql）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
