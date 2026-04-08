# Sprint PRD

## 产品目标

验证 Harness v3.1 的 GAN 对抗机制（Proposer ↔ Reviewer 无限循环）确实能在没有人为截断的情况下持续运行，直到 Evaluator 给出真正的 APPROVED 判决。目标用户是依赖 Harness 自动化开发流水线的 Cecelia 系统，确保合同对抗层不会因设计缺陷提前终止或陷入无效循环。

## 功能清单

- [ ] Feature 1: Contract GAN 无上限循环 — Proposer 提草案 → Reviewer 对抗审查 → REVISION 时自动重启下一轮，直到 APPROVED
- [ ] Feature 2: 广谱验证命令 — Evaluator 使用不依赖运行时服务的验证命令（node 文件检查），CI/headless 环境下可正确执行
- [ ] Feature 3: 机械执行器 — sprint-evaluator 严格按合同逐条验证，输出结构化 verdict，不跳过任何条目
- [ ] Feature 4: 对抗链状态透明 — 每轮 Propose/Review 的判决结果可在 Brain 任务状态中追踪，轮次无上限直到 APPROVED

## 验收标准（用户视角）

### Feature 1: Contract GAN 无上限循环
- Reviewer 返回 REVISION 时，系统自动创建新一轮 sprint_contract_propose 任务，不终止流程
- 没有任何硬编码的最大轮次限制（MAX_ROUNDS、MAX_CONTRACT_ROUNDS 等）
- 只有当 Reviewer 明确返回 APPROVED 时，流程才进入 Generator 阶段

### Feature 2: 广谱验证命令
- 合同中所有验证命令使用 `node -e` 或 `npm`/`bash` 形式，不依赖 curl/psql/服务运行
- 验证命令在无网络、无数据库的 CI 环境中可以执行并得到确定性结果
- 文件存在性检查、内容包含检查均通过 `require('fs')` 实现

### Feature 3: 机械执行器
- sprint-evaluator 逐条读取合同 SC 条目并执行对应验证命令
- 每条 SC 输出 PASS 或 FAIL，不允许跳过
- 所有 SC PASS → 写入 evaluation.md 并返回 APPROVED verdict

### Feature 4: 对抗链状态透明
- Brain 任务列表中可以看到每轮 Propose/Review 的任务记录
- 任务 result 字段包含 verdict（APPROVED/REVISION）和轮次信息
- Planner 任务在 Generator 完成后状态更新为 completed

## AI 集成点（如适用）

- Proposer（Claude agent）：生成合同草案，将技术验证命令形式化为 SC 条目
- Reviewer（Claude agent）：对抗性审查合同，发现不可测/CI 不兼容/逻辑漏洞并返回 REVISION 或 APPROVED

## 不在范围内

- Harness 完整端到端真实跑通（本 Sprint 聚焦结构验证）
- sprint_fix 修复流程（下一阶段）
- Generator 代码实现质量（由 code-review-gate 把关）
- 性能优化或对抗轮次的统计分析
