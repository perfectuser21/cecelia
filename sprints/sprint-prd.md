# Sprint PRD

## 产品目标

验证 PR #2118 修复（`harness_contract_propose verdict=null → fallback→PROPOSED`）是否真正生效，确保 Harness GAN 链路在 Proposer agent 完成但未输出 PROPOSED 关键字时不会无声卡死，而是自动 fallback 继续推进 Reviewer → GAN 对抗 → Generator 全链路。

## 功能清单

- [ ] Feature 1: fallback 触发验证 — 当 Proposer 完成但 verdict=null 时，系统自动 fallback→PROPOSED 并记录 warn 日志
- [ ] Feature 2: Reviewer 自动创建 — fallback 触发后，系统自动创建 R1 sprint_contract_review 任务
- [ ] Feature 3: GAN 对抗继续 — Reviewer 完成后根据结果（APPROVED/REVISION）自动继续 GAN 循环，直到 APPROVED
- [ ] Feature 4: Generator 自动启动 — APPROVED 后系统自动创建 sprint_generate 任务，链路完整闭合

## 验收标准（用户视角）

### Feature 1: fallback 触发验证
- 当 Proposer agent 正常完成（AI Done）但未在输出中出现 PROPOSED 关键字时，Brain execution-callback 日志中出现 `verdict=null，fallback→PROPOSED` 的 warn 记录
- fallback 触发后，`proposeVerdict` 值为 `'PROPOSED'`，链路继续推进而非停止

### Feature 2: Reviewer 自动创建
- fallback→PROPOSED 触发后，Brain 自动在 tasks 表中创建一条 `task_type=sprint_contract_review` 的任务
- 新创建的 Reviewer 任务状态为 `queued` 或 `in_progress`，不为 null/missing

### Feature 3: GAN 对抗继续
- Reviewer 完成返回 APPROVED 时，GAN 循环正常终止，进入 Generator 阶段
- Reviewer 完成返回 REVISION 时，GAN 循环自动创建下一轮 Proposer 任务（而非卡死）
- 整个对抗过程无人工干预，系统自动推进

### Feature 4: Generator 自动启动
- GAN 对抗 APPROVED 后，Brain 自动创建 `task_type=sprint_generate` 任务
- Generator 任务能正常拿到 sprint-contract.md 内容并开始执行

## AI 集成点（如适用）

- Proposer（sprint_contract_propose）：Claude agent 提出合同草案，verdict=null fallback 保护此处
- Reviewer（sprint_contract_review）：Claude agent 对抗性审查，决定 APPROVED/REVISION
- Generator（sprint_generate）：Claude agent 执行合同实现功能

## 不在范围内

- 修改 PR #2118 已有代码（本次 sprint 是验证，不是新功能）
- 测试其他 harness task_type（如 sprint_evaluate、sprint_report）
- 验证 Proposer 的合同质量（由 Reviewer 负责）
- 性能测试或并发压力测试
- UI/Dashboard 展示变更
