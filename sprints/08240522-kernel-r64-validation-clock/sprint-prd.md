# Sprint PRD — kernel validation clock 按 fix 轮有界顺延

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：消除健康长跑 Harness run 因固定 validation clock 被误杀的缺口

## 背景

本 sprint 修复 kernel validation clock 不随 fix 轮顺延导致长跑 run 被误杀的问题。`resolveValidationClock` 当前从 `spawn:generator` 起固定计算 pipeline deadline。多轮 fix 的 run 即使持续健康推进，仍会在默认 5400 秒后被误判超时；r50/r51 曾需直接修改数据库续命。本 sprint 让 kernel validation clock 随成功派发的 fix 轮有界顺延，同时保持可重放性和既有超时保护。

## Golden Path（核心场景）

Kernel 从一次已建立 validation clock、仍在健康推进的 Harness run 进入 fix 循环 → 按 `orchestrator_decision_log` 的 hop 时序识别成功派发的 `spawn:generator-fix` → 以最近一次允许的 fix 派发作为新原点重新计算 `timeout_seconds` → 在界内保持 run 存活，超过上限后照常判死。

具体：
1. r50 型长跑 run 在原始 `spawn:generator` deadline 后仍存在不超过 6 次的成功 `spawn:generator-fix` 派发时，validation clock 从最近一次允许的 fix 派发重新起算，run 保持存活。
2. 每次成功 `spawn:generator-fix` 最多贡献一次顺延；顺延次数上限为 6，纯函数结果只依赖 `orchestrator_decision_log` 行及 hop 时序，相同输入可重放得到相同结果。
3. 第 7 次及之后的 fix 派发不再顺延，越过第 6 次所建立的 deadline 后照常判死。
4. 没有 fix 轮的 run 继续以原始 `spawn:generator` 为时钟原点，现有语义不变。

## 边界情况

- 无 `spawn:generator-fix` 行时不得改变原始 deadline。
- 仅成功派发的 fix 行参与顺延；日志顺序按 hop 确定，不依赖当前时间之外的可变外部状态。
- 恰好 6 次 fix 可顺延；第 7 次不产生新原点。
- 默认 `timeout_seconds=5400` 不变；人审 deadline 不受影响。

## 范围限定

**在范围内**：kernel pipeline validation clock 的 fix 轮重置语义、6 次上限、纯函数重放行为、`tests/gp/f1/` 中真 import 冻结回归测试、合同中登记真实 `loop.js` 集成接缝。

**不在范围内**：调整默认 `timeout_seconds`、修改人审 deadline、扩展其他 deadline、以数据库补写作为运行机制、在本阶段创建 proposer 负责的其余合同三件。

## 假设

- [ASSUMPTION: “派发成功”由 `orchestrator_decision_log` 中可确定的 `spawn:generator-fix` 成功记录表达，具体字段契约由 proposer 从现有日志事实冻结。]
- [ASSUMPTION: hop 提供同一 run 内稳定全序；若存在相同 hop，合同测试必须冻结现有确定性排序语义。]
- Unified Map 未配置：task payload 有 `map_scope=["F1"]`，但缺 `map_repo`，不做领域猜测。

## 预期受影响文件

- `packages/brain/src/orchestrator/validation-clock.js`: validation clock 对外可观察语义发生变化。
- `tests/gp/f1/`: 放置真 import、禁 mock 被改边的 RED→GREEN 冻结回归测试。
- `packages/brain/DEFINITION.md`: Brain 源码变化需同步版本定义。
- `sprints/08240522-kernel-r64-validation-clock/`: proposer 后续补齐合同四件套。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 保持 `timeout_seconds` 默认 5400 秒，不改默认值。
- 频控: 最多 6 次 fix 顺延。
- 版本要求: 基于冻结 implementation baseline `09d1a044c94f888ea365759dbfbe947a4f5f4801`。
- 可观测: 判定仅依赖 `orchestrator_decision_log` 行与 hop 时序，可重放。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为与本 scope 有交集的活跃 area 铁律 -->
- [已有PR时钟] `validation_clock_required` 默认 fail-closed；已有 PR 首轮 evaluator 建钟的既有例外不得回退（来源: area）
- [派发身份] Generator 基础设施失败必须重试原始派发动作，generator-fix 仍重派 generator-fix（来源: area）
- [Planner分支] Planner 必须保持服务端签发分支，不自行 checkout 或切换（来源: area）
- [验证命令] 合同验证命令批准前必须真实运行并确认 exit code 语义（来源: area）
- [证据窗口] evaluator 一手证据、Red→Green 时序与 exit_code 必须进入 judge 消费窗口前列（来源: area）
- [真实接缝] 依赖真实调用链的接缝未真验只能登记为未覆盖，不得宣称 done（来源: area）
- [环境假设] 环境与调用方假设不得写死，必须从输入事实推导或真实校准（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII 与聊天内容不得明文进入日志（来源: area）
- [单写手] 单个任务内同一时刻只允许一个实现者修改代码（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29 golden-paths -->
- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本。
# 期望验收点：tests/gp/f1/ 真 import validation-clock.js；先证明 baseline 对 r50 场景判死，再证明新行为在 ≤6 次 fix 时存活、>6 次判死、无 fix 语义不变；真实 loop.js 接缝列入未覆盖真实链路清单。
```

## journey_type: autonomous
## journey_type_reason: 变更位于 packages/brain 的 provider 无关 orchestrator kernel 纯后端判定逻辑。
## target_environment: local_api
## target_environment_reason: task payload 显式指定 local_api，由本地 evaluator 验证 Brain kernel 纯函数与冻结测试。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
