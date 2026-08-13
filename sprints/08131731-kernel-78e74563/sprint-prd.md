# Sprint PRD — 修复本机容量三层失真：10核16GB 空机不再被算成 0 个 proposer 槽

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」
- **当前进度**：82%
- **本次推进预期**：+2%（算力全开：本机容量不再被系统性低估到派不出槽）

## 背景

kernel 容量核算对本机（us-mac-m4，10核16GB，load 2.4，内存 free 57%）算出 physical=2 / effective=1，proposer（权重2）得 floor(1/2)=0，spawn 卡 `all_execution_targets_exhausted` 25 分钟（run 8783807c 实证，靠 manually_dispatched 豁免才通过）。三层根因：① 本机 stats 采集失真使 `calculatePhysicalCapacity` 命中下限兜底 2（同公式 xian-mac-m4=16/xian-m1=12 正常，唯本机异常）；② macOS 缓存天然吃满内存，用 free% 反推 pressure 恒 0.3-0.4 → effective 永久折半，而 `platform-utils.js` 已有正确的内核自评 `getMacOSMemoryPressure` 却未接线；③ 角色权重 2 + effective=1 → floor 永久归零，无告警只有无限退避。

## Golden Path（核心场景）

系统从 [kernel 周期采集本机容量] → 经过 [真实 stats → 正确 physical → 内核 pressure → 保底非零] → 到达 [proposer 有可用槽、spawn 不再耗尽]

具体：
1. kernel 周期性采集本机（isLocal）容量，`collectLocalStats` 返回**真实** `totalMemMB=16384` / `cpuCores=10`（先取证其当前实际返回值，据取证结果修复采集失真）。
2. `calculatePhysicalCapacity` 据真实 stats 得 **physical ≥ 8**，不再命中下限兜底 2。
3. macOS 上 pressure 改用内核自评 `vm.memory_pressure` 等级映射（**Normal=0 / Warning=0.3 / Urgent=0.7 / Critical=1**），弃用 free% 推断；`effective = floor(physical × (1 - pressure))`，空载水位下 **effective ≥ 4**。
4. 角色权重折算时保底：**effective ≥ 1 则任何角色至少可派 1 个**（floor 归零死区消灭）；但 drained/offline（effective=0）机器仍**不可派**，manual override 语义不回退。
5. 出口：`curl capacity-budget` 显示 us-mac-m4 physical ≥ 8 且 effective ≥ 4，proposer available ≥ 1，spawn 不再 `all_execution_targets_exhausted`。

## 边界情况

- effective=0（drained / offline / manual override）→ 仍不可派；保底逻辑**不得**覆盖 manual override / offline 的不可派语义。
- 非 macOS（远端 Linux Unix stats）→ pressure 仍走既有 usage/free 路径，不受 macOS 内核映射影响。
- `getMacOSMemoryPressure` 返回 -1（sysctl 不可用/解析失败）→ 优雅回退到原 used_ratio 路径，不得抛错阻断采集。
- 取证若发现 physical=2 非采集 bug 而是别的成因 → 以取证结果为准调整修法，不预设结论。

## 范围限定

**在范围内**：本机 `collectLocalStats` stats 采集取证与修复；macOS pressure 改用内核自评等级映射并接线；effective≥1 时的角色派发保底（消灭 floor 归零死区）。
**不在范围内**：远端 Unix stats 采集逻辑改动；非 macOS 平台的 pressure 算法；角色权重表数值本身的调整；调度器 backoff 策略重写。

## 假设

- [ASSUMPTION: 本机 physical=2 的直接成因是 `collectLocalStats` 返回的 totalMemMB/cpuCores 失真，导致 `calculatePhysicalCapacity` 的 raw 计算偏低后命中 `Math.max(raw, 2)` 下限——需先取证确认。]
- [ASSUMPTION: us-mac-m4 当前为空载/低载水位，真验时 effective ≥ 4 成立；若真验时机器繁忙，阈值以"physical≥8 且 effective 反映真实 pressure"为准。]

## NFR 约束

<!-- 来源: decisions 表 category=nfr 空；PrepPRD(task) 隐含项优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）；`getMacOSMemoryPressure` 内部 sysctl 已有 2s 超时，采集链不得因此阻塞。
- 可观测: 角色因 effective 归零而派不出时不得静默无限退避（当前根因③"无告警"）——保底修复即消除该死区。
- 版本要求: 无

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级；本 sprint 域相关铁律（area 表另有全局 capture-triage 学习账 ~78 条，非本 feature 铁律，不逐条注入） -->
- [单slot串行] 单 slot/会话内严格串行执行，同时只允许一个任务在跑；需要并行时用多个 slot（来源: area）
- [manual不回退] drained/offline（effective=0）机器不可派，manual override / offline 的不可派语义不得被容量保底覆盖（来源: 本 sprint 硬约束）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path -->
- （本 line 暂无历史）

## 预期受影响文件

- `packages/brain/src/fleet-resource-cache.js`: `collectServerStats` / `collectLocalStats` stats 采集取证与修复；`effectiveSlots` 计算接入 macOS 内核 pressure；角色派发保底（effective≥1 至少 1 槽）。
- `packages/brain/src/platform-utils.js`: 复用/扩展 `getMacOSMemoryPressure`（内核等级 → pressure 值映射辅助）。
- `packages/brain/src/routes/capacity-budget.js`: 真验入口，curl 输出 physical/effective 反映真实资源。
- `packages/brain/src/__tests__/`（新增 failing test）: 本机 stats → physical≥8 单测；macOS pressure 映射表单测；effective=1 时 proposer available≥1 回归 + drained/offline 不可派回归。

## E2E 验收

> Planner 初稿此区块留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（vitest 单测 + curl/psql 真验）。

```bash
# 占位：proposer 将填入真实脚本（local_api → node/vitest 单测 + curl localhost:5221 真验）
# 期望验收点（自然语言）：
# 1) 单测：mock 本机级 stats（10核16384MB）→ calculatePhysicalCapacity 返回 ≥ 8。
# 2) 单测：macOS pressure 映射表（内核自评 0→0 / 1→0.3 / 2→0.7 / 3→1），darwin 上 free% 路径不再参与。
# 3) 回归：effective_slots=1 时 proposer(权重2) available ≥ 1（floor 归零死区消灭）；
#          且 drained/offline（effective=0）机器仍不可派（manual override 语义不回退）。
# 4) 真验：部署后 curl localhost:5221/api/brain/.../capacity-budget，us-mac-m4 physical ≥ 8 且 effective ≥ 4（空载水位下）。
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain/ 后端 kernel 容量核算逻辑，无 UI、无远端 agent 协议、无 engine hooks。
## target_environment: local_api
## target_environment_reason: 验收走本地 vitest 单测 + curl localhost:5221 capacity-budget 真验 + psql，无浏览器/Windows/微信真机依赖。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定，task 无 ability_id / golden-path step）
