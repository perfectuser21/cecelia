# Sprint PRD

## 产品目标

验证 Harness E2E 全链路在4个历史断点修复后（#2113/#2114/#2118/#2126）能够完整运行，从 planner 触发到 report 生成全程零人工干预。目标用户是 Cecelia 系统运营者（Alex），验证点是：系统能在无人值守的情况下独立完成一个完整的 Sprint 开发周期。

## 功能清单

- [ ] Feature 1: Planner 自动生成 PRD 并触发 GAN 链路
- [ ] Feature 2: GAN 对抗（contract_propose + contract_review）自动收敛到合同共识
- [ ] Feature 3: Generator 按合同执行 Sprint，自动创建 PR 并等待 CI
- [ ] Feature 4: Evaluator 读取 CI 结果，自主决策是否合并
- [ ] Feature 5: 合并后自动触发部署流程
- [ ] Feature 6: 全链路结束后自动生成 sprint-report 并写回 Brain 任务状态

## 验收标准（用户视角）

### Feature 1: Planner 启动
- Planner 任务触发后，系统自动生成 sprint-prd.md 并推送到分支
- Brain 自动创建 harness_contract_propose 任务，无需人工操作

### Feature 2: GAN 对抗收敛
- Generator 提出合同草案（sprint-contract.md），Evaluator 自动审查
- 对抗轮次可多轮，最终 Evaluator 输出 APPROVED，不需要人介入
- verdict=null 不再导致链路沉默中断（#2118 已修复）

### Feature 3: Generator 执行
- Generator 读取已批准的合同，自动完成代码实现，创建 PR
- SESSION_TTL 不再提前终止 Generator（#2114 已修复）
- Generator 出错时能自愈重试，不需要人工重启（#2114 已修复）

### Feature 4: Evaluator 决策
- Evaluator 读取 CI 状态，自主判断是否符合合同验收标准
- CI 测试状态不再跨轮次泄漏（#2113 已修复）
- SQL 类型错误和熔断误触发不再中断链路（#2113 已修复）

### Feature 5: 自动合并与部署
- Evaluator 批准后系统自动合并 PR
- 合并事件自动触发后续部署流程

### Feature 6: 报告生成
- harness_report 任务被正确创建并执行（#2114 已修复）
- 报告内容包含：轮次数、最终 verdict、PR 链接、CI 结果摘要
- Brain 中当前任务状态自动回写为 completed

### 全链路零干预标准
- harness_* 任务在整个生命周期内受 escalation/cleanup 保护，不被误清理（#2126 已修复）
- 从 planner 触发到 report 完成，全程无人工介入事件

## AI 集成点

- GAN 对抗：Generator（Sonnet）和 Evaluator（Sonnet）两个角色相互对抗，无需人工裁判
- Generator 代码实现：由 AI 根据合同自主完成
- Evaluator CI 判定：AI 读取 CI 输出，自主输出 PASS/FAIL verdict

## 不在范围内

- Generator 生成的具体功能内容的质量评审（只验链路通断，不评内容好坏）
- 新增或修改任何 Brain/Engine 核心代码
- 修改 CI 流水线配置
- 覆盖率提升或测试补充
- 对4个断点修复本身的代码审查（已在对应 PR 完成）
