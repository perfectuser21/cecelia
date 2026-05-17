# cp-0508082901 — Harness propose_branch 协议 mismatch 双修

**日期**: 2026-05-08
**Branch**: cp-0508082901-harness-propose-branch-protocol-fix
**触发**: W8 acceptance task 49dafaf4 fail at inferTaskPlan

## 现象

W8 14 节点 acceptance 跑到 inferTaskPlan 报：
`fatal: invalid object name 'origin/cp-05080823-49dafaf4'`

但 origin 上实际有 `cp-harness-propose-r1-49dafaf4` + `cp-harness-propose-r2-49dafaf4`，且两个分支都含真实 task-plan.json。

### 根本原因

两层 bug 叠加：

1. **SKILL 文档 bug**：`packages/workflows/skills/harness-contract-proposer/SKILL.md` Step 4 line 314 把 verdict JSON 输出限定在"GAN APPROVED 后"。LLM 按字面理解，r1/r2 没 APPROVED 时不输出 JSON。但 brain `harness-gan.graph.js` line 393 每轮调用 proposer 后立刻 `extractProposeBranch(stdout)` → 解析失败 → 走 fallback。

2. **Graph fallback bug**：`fallbackProposeBranch` 生成 `cp-MMDDHHmm-{taskIdSlice}` 格式（如 `cp-05080823-49dafaf4`），跟 SKILL Step 4 实际 push 的 `cp-harness-propose-r{N}-{taskIdSlice}` 完全不一致。任何走 fallback 的 case 都拿到不存在的分支名，inferTaskPlan 拿不到 task-plan.json 硬 fail（PR #2820 加的"硬 fail 不静默"逻辑生效）。

PR #2820 修了"proposer 每轮写 task-plan.json"+"inferTaskPlan 硬 fail"，但**没修 SKILL stdout 输出 verdict JSON 的限定词，也没修 fallback 格式**——所以 task-plan.json 写在 propose r2 分支上，graph 却找 fallback 名分支，命中失败。

## 下次预防

- [ ] **协议契约成对改**：任何"SKILL 输出格式 ↔ brain 解析约定"的协议变更必须 SKILL 端 + brain 端 + fallback 一并改，避免单边改造成隐患
- [ ] **Fallback 必须跟主路径同格式**：fallback 是兜底不是另一种实现，不能跟主路径的命名/格式不一致
- [ ] **SKILL DSL 写"APPROVED 后"等条件限定时务必想清楚 LLM 按字面理解会怎样**：LLM 不会推理"虽然限定 APPROVED 但 brain 每轮都需要"
- [ ] **新协议字段必须有 lint test**（SKILL.md grep 输出契约 + brain regex 命中样例），双向闭环
- [ ] **删/改函数签名时 grep 全 repo 找 caller**：本次发现 `src/harness-gan-graph.js` 是 shim re-export，但 `src/__tests__/harness-gan-graph.test.js` 还在测旧签名（顺手清理 line 503-525 + 更新 line 467-485 的 integration test）

## 修复方案

- SKILL Step 4 删 APPROVED 限定，改"每轮（含被 REVISION 打回轮）"，加"输出契约"段
- Graph fallback 改用 `cp-harness-propose-r{round}-{taskIdSlice}` 跟 SKILL push 同格式（签名 `(taskId, round)` 替代 `(taskId, now)`）
- 加 9 个 unit test 覆盖 extract + fallback + SKILL lint
- 加 smoke.sh 真环境验证 3 个 case
- 顺手清理 `src/__tests__/harness-gan-graph.test.js` 旧 fallback 测试段 + 更新 integration test 断言
