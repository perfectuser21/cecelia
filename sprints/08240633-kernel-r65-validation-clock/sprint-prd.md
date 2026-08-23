# Sprint PRD — kernel validation clock 按 fix 轮有界顺延

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：消除健康长跑 Harness run 因固定 pipeline deadline 被误杀的已知风险。

## 背景

kernel validation clock 当前从 `spawn:generator` 起固定计算 `timeout_seconds`（默认 5400 秒）。经历多个 generator-fix 轮次但仍健康推进的 run 会撞上旧 deadline，被误判死亡。本 sprint 修复 validation clock 不随 fix 轮顺延的问题，同时保持顺延次数有界、结果可由决策日志重放。

## Golden Path（核心场景）

Harness kernel 从首次 generator 成功派发进入验证计时 → 每次成功的 `spawn:generator-fix` 至多重置六次计时原点 → validation clock 根据决策日志 hop 时序给出可重放的存活或超时结果。

具体：
1. run 已有成功的 `spawn:generator`，并进入耗时较长的验证与修复循环。
2. 每次 `spawn:generator-fix` 派发成功后，pipeline deadline 从该成功行为重新起算同一个 `timeout_seconds`。
3. 第 1 至第 6 次成功 fix 派发允许顺延；第 7 次及以后不再延长，达到有效 deadline 时照常判死。
4. 相同 `orchestrator_decision_log` 行与 hop 时序始终产生相同结果，不依赖当前进程内状态。
5. r50 型场景在有效窗口内保持存活；没有 fix 轮的 run 与既有计时语义一致。

## 边界情况

- 只有派发成功的 `spawn:generator-fix` 才能成为新原点，失败或非 fix 行不顺延。
- 六次以内按最新成功 fix 原点计时；超过六次后不得继续续期，超时仍判死。
- 无 `spawn:generator-fix` 时继续从首次成功的 `spawn:generator` 起算。
- 日志重放顺序以 hop 时序为准；同一输入不得因墙钟读取之外的隐式状态改变结论。

## 范围限定

**在范围内**：`resolveValidationClock` 的 pipeline deadline 计算；r50 误杀复现、六次边界、超限及无 fix 回归的冻结测试；真实导入被改模块。

**不在范围内**：修改 `timeout_seconds` 默认值；修改人审 deadline；扩展到其他 deadline；把 `loop.js` 真库接缝宣称为已覆盖。

## 假设

- [ASSUMPTION: “派发成功”以 `orchestrator_decision_log` 中可识别的成功 `spawn:generator-fix` 决策行为为准。]
- [ASSUMPTION: 上限六次按 hop 时序选取前六个成功 fix 行；更晚 fix 行不改变有效原点。]

## 预期受影响文件

- `packages/brain/src/orchestrator/validation-clock.js`: validation clock 的对外行为发生修正。
- `tests/gp/f1/`: 放置 RED 先行并永久保留的冻结回归测试，真实 import validation-clock，禁止 mock 被改的边。
- `packages/brain/DEFINITION.md`: Brain 源码行为变更对应的版本同步。
- `sprints/08240633-kernel-r65-validation-clock/`: 合同四件套所在目录；后续阶段补齐 contract-draft、contract-dod 与冻结测试。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 保持 `timeout_seconds` 默认 5400 秒，不改变超时参数本身。
- 频控: fix 顺延最多 6 次。
- 版本要求: 待定（PrepPRD 未指定）。
- 可观测: 结果必须能仅由 `orchestrator_decision_log` 行与 hop 时序重放。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；step/feature 为空，area 活跃铁律按本 sprint 适用面收录 -->
- [重派语义] Generator 基础设施失败必须重试原始服务端派发动作：首次 generator 重派 generator，generator-fix 重派 generator-fix。（来源: area）
- [分支权威] Planner workspace 必须保持服务端签发的 planner_branch，Provider 不得 checkout 或切换分支。（来源: area）
- [验证时钟] 保留 validation_clock_required 默认 fail-closed，不以临时旁路替代正常验证时钟。（来源: area）
- [时间不变量] 跨模块时间常数存在大小关系时必须显式形成可验证的不变量。（来源: area）
- [真实边界] 回归测试须使用真实 import 或 source inspection，禁止用 mock 覆盖被修改的调度边。（来源: area）
- [接缝真验] 依赖真实调用方的接缝未在真目标验证时只能登记未覆盖，不得宣称 done。（来源: area）
- [串行会话] 一个 slot/会话内任务严格串行，前一任务收口后才启动下一任务。（来源: area）
- [秘密保护] secrets 不得硬编码、进入 git 或日志。（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本。
# 期望验收点：冻结测试真实导入 validation-clock.js；r50 场景修前判死、修后存活；第 7 次 fix 超限仍判死；无 fix 轮结果不变；并登记 loop.js 真实链路未覆盖。
```

## journey_type: autonomous
## journey_type_reason: 变更位于 packages/brain 的 provider 无关执行内核，属于纯后端自治调度行为。
## target_environment: local_api
## target_environment_reason: Brain 内部纯函数与本地真实模块导入测试在本地 evaluator 执行，不需要远端机器。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
