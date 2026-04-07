# Sprint PRD

## 产品目标

用户触发一次 Harness sprint 后，系统能可靠地走完 Planner → Contract 对抗 → Generator → Evaluator → Report 完整流程，不会在中途卡死或悄悄断链。最终交付物：可运行的 CI 测试证明整条链路的每个转接点都正确工作。

## 功能清单

- [ ] Feature 1: Sprint Report 生成 — 用户能看到 Harness 完成后的最终报告（PRD 目标、对抗轮次、修复清单）
- [ ] Feature 2: Contract 对抗防无限循环 — 合同协商轮次有上限，超出后系统自动以最后一版草案作为合同继续
- [ ] Feature 3: Contract Draft 持久化 — Proposer 完成草案后立即 git push，Reviewer 在任何 worktree 都能读到
- [ ] Feature 4: v3.1 断链测试覆盖 — CI 测试覆盖完整 v3.1 流程（sprint_planner→contract_propose→contract_review→sprint_generate→sprint_evaluate→sprint_report），每个转接点都有断言

## 验收标准（用户视角）

### Feature 1
- 当 sprint_evaluate 返回 PASS 时，用户能在 `sprints/sprint-report.md` 看到报告文件
- 报告包含：PRD 目标摘要、对抗轮次、PASS/FAIL 统计、最终 verdict
- sprint_report 任务能被 Brain 正常调度（task-router 映射存在且 skill 可执行）

### Feature 2
- 当 contract_review 连续返回 REVISION 超过设定上限（如 5 轮）时，系统不再创建新的 contract_propose，而是以现有草案继续推进到 sprint_generate
- 系统在日志中记录"合同协商已达上限，强制推进"
- 不会出现无限 contract_propose ↔ contract_review 循环

### Feature 3
- Proposer 完成写入 `contract-draft.md` 后，文件出现在远程分支
- Reviewer 能直接读取该文件，不依赖 Proposer 和 Reviewer 在同一 worktree

### Feature 4
- `brain-ci.yml` 中的 L2 测试能对以下转接点做出断言：
  - sprint_planner 完成 → 创建 sprint_contract_propose（携带正确 payload）
  - sprint_contract_propose 完成 → 创建 sprint_contract_review
  - sprint_contract_review APPROVED → 创建 sprint_generate
  - sprint_contract_review REVISION → 创建新的 sprint_contract_propose（round+1）
  - sprint_contract_review REVISION 达上限 → 强制推进 sprint_generate
  - sprint_generate 完成 → 创建 sprint_evaluate
  - sprint_evaluate PASS → 创建 sprint_report
  - sprint_evaluate FAIL → 创建 sprint_fix
  - sprint_fix 完成 → 创建 sprint_evaluate（eval_round 正确）
  - sprint_evaluate result=null → 重试 sprint_evaluate（不创建 sprint_fix）

## AI 集成点（如适用）

- Sprint Report skill 调用 Brain API 汇总当前 sprint 所有任务的执行记录
- Contract 对抗轮次、token 用量等数据从 Brain tasks 表读取，不需要额外存储

## 不在范围内

- 不改变 sprint_evaluator 的命令解析逻辑（已有 execSync 机制，不重写）
- 不修改 sprint-planner / sprint-contract-proposer / sprint-contract-reviewer 的核心对抗逻辑
- 不引入新的数据库字段或迁移
- 不改变 task-router 的路由格式或 LOCATION_MAP 结构

## 成功标准

- `npx vitest run packages/brain/src/__tests__/harness-sprint-loop.test.js` 全部绿灯
- sprint_report skill 在本地可执行不报错
- contract_propose max_rounds 保护在测试中有专项覆盖
