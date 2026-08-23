# Sprint PRD — kernel validation clock 按 fix 轮有界顺延

## OKR 对齐

- **对应 KR**：未配置（Brain context 未返回活跃 KR）
- **当前进度**：未提供
- **本次推进预期**：消除健康 fix 长跑被固定 pipeline deadline 误杀的最后一层风险

## 背景

`resolveValidationClock` 当前以 `spawn:generator` 为固定原点计算 `timeout_seconds`（默认 5400 秒），使仍在健康推进、经历多轮 `spawn:generator-fix` 的 run 被误判超时。r50/r51 已出现依赖数据库续期的真实案例；r55-r61 的其他封印误杀已清理，本 sprint 只收敛 validation clock 的 fix 轮时序语义。

## Golden Path（核心场景）

系统从 kernel validation clock 读取 `orchestrator_decision_log` 的 hop 时序 → 识别成功派发的 `spawn:generator-fix` → 在最多 6 次的边界内以最近一次成功 fix 派发为新原点重算 `timeout_seconds` → 输出可重放且确定的存活/判死结果。

具体：
1. 一个已建立 pipeline validation clock 的 run 成功派发 `spawn:generator-fix`。
2. 第 1 至第 6 次成功 fix 派发分别刷新 pipeline deadline；计算只依赖 decision log 行及 hop 顺序，不依赖墙钟外的可变状态。
3. r50 型长跑在新 deadline 内保持存活；第 7 次及以后不再获得顺延并照常判死。
4. 没有 fix 轮的 run 与现有语义完全一致。

## 边界情况

- 只计算成功派发的 `spawn:generator-fix`；不存在该行为时保留原 `spawn:generator` 原点。
- 最多 6 次顺延，第 7 次及以后不能延长 pipeline deadline。
- 日志重放顺序由 hop 决定；相同输入必须得到相同结果。
- pipeline timeout 已过且没有可用顺延时照常判死。

## 范围限定

**在范围内**：pipeline validation clock 的 fix 轮有界顺延；r50 场景 RED→GREEN；超限和无 fix 轮回归；测试文件真实入库。

**不在范围内**：修改 `timeout_seconds` 默认值；修改人审 deadline；宣称 `loop.js` 真库集成链路已覆盖。

## 假设

- [ASSUMPTION: “派发成功”以 `orchestrator_decision_log` 中已落盘且可按 hop 排序的 `spawn:generator-fix` 行为为准。]
- [ASSUMPTION: Unified Map 未配置 `map_repo`，因此本轮只使用 payload 的 `gp_anchor=factory/F1 造完真验` 与 anchor UUID 锚定范围。]

## 预期受影响文件

- `packages/brain/src/orchestrator/validation-clock.js`：validation clock 对外行为发生变化。
- `tests/gp/f1/validation-clock-fix-extension.test.ts`：直接 import 真模块的永久回归测试，禁止 mock 被改边。
- `packages/brain/DEFINITION.md`：Brain 源码行为变化所需版本同步。

## 可执行验收计划

1. 先提交 r50 型 failing test：原始 generator deadline 已过、最近一次成功 fix deadline 未过；基线必须判死。
2. 实现后同一测试必须转绿，且断言最近成功 fix 派发成为新计算原点。
3. 覆盖恰好 6 次仍可顺延，以及第 7 次即使存在也不再顺延并判死。
4. 覆盖零 fix 行为，结果与修复前语义一致。
5. 用相同但重新构造的 decision-log 输入重复调用，断言结果一致，证明纯函数可重放。
6. 测试必须位于 `tests/gp/f1/`、真实 import `packages/brain/src/orchestrator/validation-clock.js`，并作为 Test Contract 路径提交；`loop.js` 接缝列入“未覆盖真实链路清单”。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 保持 `timeout_seconds` 默认 5400 秒，不改变原超时口径
- 频控: 不适用
- 版本要求: Brain 行为版本与 `DEFINITION.md` 同步
- 可观测: 判定仅依赖已记录的 orchestrator decision log hop 时序，重放结果确定

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为本 F1/kernel scope 可适用铁律 -->
- [原派发身份] Generator 基础设施失败须重试原始服务端派发动作，generator-fix 仍重派 generator-fix（来源: area）
- [验证时钟封闭] validation_clock_required 默认 fail-closed；existing-PR evaluator 仅在既定 hotfix 真相条件下建立一次共享时钟（来源: area）
- [验证真相] local_api 无 UI 任务须在合同声明验证真相形态，避免 meta verification 假死锁（来源: area）
- [证据前置] evaluator 须把根因、RED→GREEN 时序与 exit code 一手证据置于 Judge 消费窗口前列（来源: area）
- [命令真跑] 合同验证命令批准前须真实执行并确认 exit code 与目标解释器启动（来源: area）
- [测试质量] Test Contract 固定四列且测试路径置于第三列；测试须满足真实异步调用质量闸（来源: area）
- [RED精确提交] RED commit 仅加入精确测试路径，禁止混入非测试文件（来源: area）
- [毕业门禁] 测试入册后须通过 TDD commit-order 与 test-coverage 门禁（来源: area）
- [真实接缝] 依赖真实调用方的接缝未真验只能登记覆盖余留，不得标记 done（来源: area）
- [环境假设] 环境假设值不得写死，须从输入推导或真实校准（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII 与聊天内容不得明文进入日志（来源: area）
- [单会话串行] 同一 slot 只推进一个任务，写代码实现者同一时刻仅一个（来源: area）
- [Planner分支] Planner 必须保持服务端签发分支，Provider 不得 checkout 或 switch（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本。
# 期望验收点：真实加载 validation-clock.js 后，r50 场景 RED→GREEN；6 次内顺延，第 7 次判死；零 fix 语义不变；重复重放结果一致。
```

## journey_type: autonomous
## journey_type_reason: 变更位于 packages/brain 的 kernel 纯后端 validation clock。
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api，由本地 evaluator 对 Brain 真模块与测试产物验收。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
