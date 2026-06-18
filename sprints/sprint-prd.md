# Sprint PRD — Harness Pipeline Cockpit · Phase 3（Gate 1 决策面板 + 点火）

## OKR 对齐

- **对应 KR**：Harness Pipeline 可观测可操作（cockpit 从"只读看全程" → "在 Gate 1 出手"）
- **当前进度**：Phase 1 已合（#3395 PrepPRD 全文）、Phase 2 已合（#3400 read-only 七项全生命周期视图）
- **本次推进预期**：从"只读"迈到"可在 Gate 1 决策并点火"——cockpit 的第一个写操作

## 背景

Phase 2 已让一个 pipeline 的七项产物全程只读可见，但走到 Gate 1（合同/决策待确认）就断了：用户看得到决策，却改不了、也无法在页面上推进。Phase 3 在 cockpit 上接出 Gate 1 操作面：把本轮待决策项摆出来、允许人改一条、允许"再来一轮"让无头红队对合同再质询，最后一键"确定点火"把 pipeline 从 Gate 1 推进到执行。这是 cockpit 第一次落写操作，Phase 4（Gate 2 闭环 / 题库回灌）不在本轮。

## Golden Path（核心场景）

用户从 [打开某停在 Gate 1 的 pipeline 详情页] → 经过 [审阅决策面板 / 改决策 / 可选再来一轮红队] → 到达 [点"确定点火"后 pipeline 离开 Gate 1 进入执行]

具体：
1. 用户打开一个停在 Gate 1（合同/决策待确认）状态的 pipeline 详情页。
2. 页面在生命周期视图里展开 **Gate 1 决策面板**：列出本轮待决策项（来自该 pipeline 的 decisions / 合同断言），每项可读其内容与当前取值。
3. 用户可**编辑某一条决策**的取值并保存（写回 Brain）。
4. 用户可点 **「再来一轮」**：触发无头红队对当前合同/决策再质询一轮（不需人工干预），结果回灌到决策面板。
5. 用户点 **「确定点火」** → 命中点火端点 → pipeline 状态从 Gate 1 推进到执行（开始跑 Task）。
6. 可观测结果：点火后页面反映 pipeline 已离开 Gate 1（状态/留痕更新），且 Brain 侧记录到这次点火与改动后的决策。

## 边界情况

- pipeline 不在 Gate 1（已点火/已完成/尚未到 Gate 1）→ 决策面板按状态降级：展示但禁用"确定点火"，给语义化提示，不报错。
- 决策面板查无待决策项 → 显示"暂无待决策"占位，"确定点火"按是否允许直接放行决定可用性。
- 改决策保存失败 / 点火端点失败（网络/校验）→ 面板内联报错并保留用户输入，不让整页崩、不静默吞错。
- 「再来一轮」红队进行中 → 按钮置忙、禁止重复触发，完成后刷新面板。

## 范围限定

**在范围内**：cockpit 详情页 Gate 1 决策面板（展示待决策项）；编辑并保存单条决策（写回 Brain）；「再来一轮」触发无头红队再质询；「确定点火」命中点火端点推进 pipeline 离开 Gate 1；以上写路径所需的 Brain 端点（若 api_registry 缺，由 Proposer 锁定/约定）。先写 failing test 再实现。

**不在范围内**：Phase 4（Gate 2 闭环、题库回灌）；批量改多条决策；红队算法本身的实现细节（仅触发既有无头红队入口）；Gate 1 之外的状态机改造。

## 假设

- [ASSUMPTION: Phase 2 的生命周期 cockpit 组件可在其"决策清单"分区上扩出 Gate 1 操作面板，复用同一详情页与取数路径。]
- [ASSUMPTION: Brain 已有或可约定：改单条决策（写 decisions）、触发无头红队再质询、确定点火三个写端点；具体路径/字段由 Proposer 读 api_registry 后锁定。]
- [ASSUMPTION: "Gate 1 待确认"状态可由 pipeline/run 当前 phase 字段判定，无需新增状态机。]

## 预期受影响文件

- `apps/dashboard/src/pages/`（Phase 2 cockpit 详情页/组件）：决策清单分区扩出 Gate 1 决策面板 + 改决策 + 再来一轮 + 确定点火按钮与调用。
- 对应 dashboard 测试文件：新增 failing test 覆盖面板展示 / 改决策保存 / 点火调用 / 非 Gate 1 状态降级。
- （可能）`packages/brain/src/`：补改决策 / 触发红队 / 确定点火的写端点（由 Proposer 确认是否已存在）。

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=mac_web（Playwright + Brain 写校验）填入 contract-draft.md。

```bash
# 占位：proposer 将填入 mac_web Playwright 脚本（localhost:5174）+ Brain 写副作用校验
# 期望验收点（自然语言）：
#   1. 打开一个停在 Gate 1 的 pipeline 详情页，看到 Gate 1 决策面板列出待决策项。
#   2. 编辑一条决策并保存 → Brain 侧 decisions 记录被更新（查 DB/API 确认字段变化）。
#   3. 点"确定点火" → pipeline 状态离开 Gate 1 进入执行（查 run/task 状态或留痕确认）。
#   4. （可选）点"再来一轮" → 触发无头红队再质询且面板刷新，无整页崩溃。
```

## journey_type: user_facing
## journey_type_reason: 改动主体落在 apps/dashboard/ 前端 cockpit 详情页，命中 if-elif 链首条 user_facing。
## target_environment: mac_web
## target_environment_reason: Cecelia 内网 Dashboard Web UI，Final E2E 走本机 Playwright（localhost:5174）驱动页面 + 校验 Brain 写副作用。
## journey_id: Cecelia Line 唯一 = Harness Pipeline（来源 task.payload.journey_id，Brain 离线未取到，按 PrepPRD 锚定为 Harness Pipeline 线）
## step_id: cockpit-phase3-gate1-fire（4-Phase cockpit 的 Phase 3 · Gate 1 决策面板 + 点火）
