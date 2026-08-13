# Sprint PRD — 修复本机 kernel 容量三层失真（10核16GB 空机被算成 0 个 proposer 槽）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消灭本机算力归零死区，恢复 proposer 可派）

## 背景

run 8783807c 实证：us-mac-m4（10核16GB、load 2.4、内存 free 57%）的 kernel 容量被算成
physical=2 / effective=1，proposer（角色权重2）得 floor(1/2)=0，spawn 卡
`all_execution_targets_exhausted` 25 分钟，只能靠 `manually_dispatched` 豁免通过。
同公式下 xian-mac-m4=16 / xian-m1=12 正常，唯独本机异常。三层根因叠加导致空载机器被判无算力。

## Golden Path（核心场景）

系统从 [采集本机资源] → 经过 [计算物理/有效容量] → 到达 [为各角色派出可用槽位]

具体：
1. [触发] kernel 周期性对 us-mac-m4（本机，isLocal=true）采集 stats（cpuCores/totalMemMB）
2. [系统处理] `calculatePhysicalCapacity` 用真实资源算出 physical_capacity（10核16GB → ≥8）
3. [系统处理] macOS 上有效容量用内核自评压力等级折算：`effective = floor(physical × (1-pressure))`，
   pressure 来自 `getMacOSMemoryPressure` 等级映射（Normal=0/Warning=0.3/Urgent=0.7/Critical=1），
   不再用 `1 - 内存free%` 推断
4. [保底] effective≥1 时，任何角色（含 proposer 权重2）的 available 至少为 1，消灭 floor 归零死区
5. [可观测结果] `curl capacity-budget` 显示 us-mac-m4 physical≥8、effective≥4（当前空载水位）；
   drained/offline（effective=0）机器仍不可派（manual override 语义不回退）

## 边界情况

- `getMacOSMemoryPressure` 返回 -1（sysctl 失败/非 darwin）→ 回退到既有 used_ratio 路径，不得崩溃
- effective=0（真实 drained/offline 或 Critical 压力）→ 保底规则不得把它抬成 ≥1，仍判不可派
- 非本机（远端 Unix）与非 macOS 平台的 pressure 路径不受本次改动影响，保持原行为

## 范围限定

**在范围内**：
- `calculatePhysicalCapacity` / `collectLocalStats` 本机 stats 采集失真取证与修复（根因①）
- macOS pressure 改用内核自评等级映射，弃用 free% 推断（根因②）
- effective≥1 时角色保底 ≥1 槽，消灭 floor 归零死区（根因③）

**不在范围内**：
- 远端 Unix 机器容量公式
- 角色权重体系本身的重设计
- 派发调度器（thalamus/task-router）逻辑

## 假设

- [ASSUMPTION: 本机 physical=2 的直接原因是 `collectLocalStats` 采回的 totalMemMB/cpuCores 失真，
  须在实现阶段先打印实际返回值取证后再定采集修法]
- [ASSUMPTION: MAX_PHYSICAL_CAP 与 memPerTaskMb=400 等既有参数保持不变，仅修采集与 pressure 口径]

## 预期受影响文件

- `packages/brain/src/fleet-resource-cache.js`: `collectServerStats`（:54 physical、:59 effective）本机采集与压力口径
- `packages/brain/src/platform-utils.js`: `calculatePhysicalCapacity` 下限兜底、`getMacOSMemoryPressure` 接线到有效容量链
- `packages/brain/src/routes/infra-status.js`: :113 已记录同类教训的注释链路，容量口径对齐

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本 task/journey 均返回空数组），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: 容量口径必须可经 `capacity-budget` API 查询验证；effective 归零死区消除后不得出现无告警的无限退避

## E2E 验收

> Planner 初稿留占位。最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入。

```bash
# 占位：proposer 将填入 local_api 脚本（curl localhost:5221 + psql）
# 期望验收点（自然语言）：
#  1) 单测 mock 本机 stats(10核16384MB) → calculatePhysicalCapacity ≥ 8
#  2) 单测 macOS pressure 映射表 0→0 / 1→0.3 / 2→0.7 / 3→1，darwin 上 free% 路径不再参与
#  3) 回归 effective_slots=1 时 proposer(权重2) available ≥1；effective=0 机器仍不可派
#  4) 真验：部署后 curl capacity-budget，us-mac-m4 physical ≥8 且 effective ≥4
```

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 两源本 task 返回空） -->
- [口径三源失真] 指标/容量类异常先查口径三源失真（未接线恒空 / 守卫自噬 / 双重计数）再当真实退化处理（来源: area）
- [验证命令实跑] 合同验证命令必须实跑确认 exit code 语义（vitest 对 include 范围外路径绿态也退出0）（来源: area）
- [证据前置] evaluator 产 .brain-result.json 必须把一手证据放前 8 条×600 字符窗口内（来源: area）
- [证据窗口] judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」，evidence_insufficient 优先走补证（来源: area）
- [评估时钟] Kernel 既有 PR 的 evaluator 采用 validation clock 校验（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 journey 已完成 ability 的 golden_path -->
- （本 line 暂无历史）

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 纯后端容量计算，无 UI / 远端 agent / engine 路径
## target_environment: local_api
## target_environment_reason: Brain 内部容量口径，验证走本地 evaluator（curl localhost:5221 capacity-budget + vitest 单测）
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
