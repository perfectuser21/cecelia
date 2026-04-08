# 合同草案（第 3 轮）

**Sprint**: Harness v3.1 流水线稳固
**Generator**: Contract Proposer Round 3
**基于**: Planner 任务 3217cdf0（4 个断链点识别）+ 前两轮 review 反馈

---

## 本次实现的功能

- Feature A: Contract 防死循环 — 在 execution.js REVISION 路径加 MAX_CONTRACT_PROPOSE_ROUNDS 保护
- Feature B: Contract Draft 跨 worktree 持久化 — Proposer/Reviewer 写文件后立即 git push
- Feature C: sprint-report 可调用性验证 — 确认 skill 路由可达，无需新增代码

> Feature D（v3.1 测试覆盖）：`harness-sprint-loop-v3.test.js` 已存在并覆盖 GAN 层；本次补充 MAX_CONTRACT_PROPOSE_ROUNDS 场景测试用例。

---

## 验收标准（DoD）

### Feature A: Contract 防死循环

**行为描述**：
- 当 `sprint_contract_review` 返回 `REVISION`，且当前 `propose_round < MAX_CONTRACT_PROPOSE_ROUNDS`（定为 5）时，正常创建下一轮 `sprint_contract_propose`
- 当 `propose_round >= MAX_CONTRACT_PROPOSE_ROUNDS` 时，不再创建新 propose 任务；改为将当前 contract-draft.md 强制升格为 sprint-contract.md（保底通过），并继续后续流程
- 当 `propose_round` 字段缺失时，默认为 1，不崩溃

**硬阈值**：
- `execution.js` 中 REVISION 路径必须含 `MAX_CONTRACT_PROPOSE_ROUNDS` 常量，值为 `5`
- 当 `nextRound > MAX_CONTRACT_PROPOSE_ROUNDS` 时，代码路径不调用 `createHarnessTask`
- 保底逻辑：将 `sprints/${sprint_dir}/contract-draft.md` 复制为 `sprint-contract.md`（或写入等效内容），并继续触发 `sprint_generate`
- 函数调用路径变更不影响正常 `propose_round=1` 场景（回归保护）

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

### Feature B: Contract Draft 跨 worktree 持久化

**行为描述**：
- 当 Generator 写完 `contract-draft.md` 后，必须执行 `git add` + `git commit` + `git push origin HEAD`
- 当 Reviewer 写完 `contract-review-feedback.md` 后，同样执行三步 git push
- 当 git push 成功时，下一个 worktree 可直接 `cat ${sprint_dir}/contract-draft.md` 读到内容
- 当 git push 失败（网络问题）时，任务不阻塞 — 继续回调 Brain（push 失败视为软错误，记录日志但不重试）

**硬阈值**：
- `sprint-contract-proposer/SKILL.md` 中必须含 `git push origin HEAD` 命令（Phase 3 / 持久化步骤）
- `sprint-contract-reviewer/SKILL.md` 中必须含 `git push origin HEAD` 命令
- git push 命令位于文件写入成功之后，不在文件写入之前
- push 步骤的 commit message 格式：`chore(harness): contract draft round ${N}` 或 `chore(harness): contract review round ${N}`（N 为 propose_round 值）

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

### Feature C: sprint-report 可调用性验证

**行为描述**：
- 当 Brain dispatch `sprint_report` 任务时，executor 能正确拼接 `/sprint-report` skill prompt
- 当 headless account 执行 `/sprint-report` 时，skill 文件存在且可读

**硬阈值**：
- `packages/workflows/skills/sprint-report/SKILL.md` 文件存在（非零字节）
- `task-router.js` 中 `sprint_report` → `/sprint-report` 映射存在
- `.agent-knowledge/skills-index.md` 中含 `sprint-report` 或 `sprint_report` 条目（任意一种）
- 以上三项验证结果均为 PASS，无需新增代码

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

### Feature D: MAX_CONTRACT_PROPOSE_ROUNDS 测试覆盖

**行为描述**：
- 当测试模拟 `propose_round = 5`（MAX），Reviewer 返回 REVISION 时，execution callback 不再创建 `sprint_contract_propose` 任务
- 当测试模拟 `propose_round = 4`（MAX-1），Reviewer 返回 REVISION 时，正常创建第 5 轮 propose 任务

**硬阈值**：
- `harness-sprint-loop-v3.test.js` 中新增 2 个 test case（或在现有测试文件同目录新建 `contract-max-rounds.test.ts`）
- Test case 1：propose_round=5 + REVISION → `createHarnessTask` 调用次数为 0（或调用的是 sprint_generate，而非 sprint_contract_propose）
- Test case 2：propose_round=4 + REVISION → `createHarnessTask` 被调用，且 `task_type = 'sprint_contract_propose'`，`propose_round = 5`
- 两个 test case 均通过 `vitest` 无报错

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

## 技术实现方向（高层）

- **execution.js**：在 REVISION 分支顶部增加 `const MAX_CONTRACT_PROPOSE_ROUNDS = 5;` 常量，并用 `if (nextRound > MAX_CONTRACT_PROPOSE_ROUNDS)` 分支保底升格
- **sprint-contract-proposer/SKILL.md**：Phase 3 补充 `git add → git commit → git push origin HEAD`（已有注释框架，补充实际命令）
- **sprint-contract-reviewer/SKILL.md**：同上，确保 Reviewer 也 push feedback 文件
- **测试**：在 `harness-sprint-loop-v3.test.js` 追加 MAX_ROUNDS 相关 describe block

## 不在本次范围内

- `harness_contract_propose/review`（harness v4 任务类型）的 MAX 保护 — 仅修 `sprint_contract_propose/review`
- sprint-report 的输出内容格式 — 只验证 skill 可达，不验证报告内容质量
- GAN 执行阶段（sprint_evaluate / sprint_fix）的轮次上限 — 设计上无上限，禁止修改
- Brain 数据库 migration — 本次无 schema 变更
