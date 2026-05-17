# Learning: Harness v3.0 重构 — 对标 Anthropic 官方论文

## 背景

Sprint 3 跑完后，发现我们实现的 Harness 与 Anthropic 官方论文（March 24, 2026）存在根本性偏差。官方设计是四步流程，我们额外自创了"合同协商"阶段，Evaluator 也没有真正执行验证命令。

## 根本原因

### 偏差 1：自创 contract_propose/review 阶段

官方：Planner 写 spec 时就把验证命令定死（广谱性靠这里），之后直接 Generator → Evaluator。
我们：在 Planner 和 Generator 之间加了 contract_propose ↔ contract_review 的多轮协商，与官方设计不符。

**为什么错了**：对抗应该发生在 spec 写作阶段（Planner），而不是再加一个协商环节。

### 偏差 2：Evaluator 静态文件检查

官方：Evaluator 是"无脑执行器"——执行真实命令（curl/npm test/psql/bash），只看 exit code。
我们：Evaluator 用 `readFileSync` + `includes` 检查文件内容，相当于只看代码写了没有，不验证运行行为。

**为什么错了**：静态检查无法发现运行时 bug，Playwright 方案太重，广谱性才是关键。

### 偏差 3：缺少 sprint_report

官方：最终步骤是生成报告（合同内容、轮次、修复清单、token/cost）。
我们：用 arch_review 替代，不是 Harness 内部任务，也没有成本统计。

### 偏差 4：sprint_num 分层

官方：v2 已删掉 sprint 分层，Generator 内部切分，不需要 sprint_num 层。
我们：保留了 sprint_num，每次 PASS 后重新协商新 sprint，复杂度不必要。

## 修复内容

1. **sprint-planner/SKILL.md v2.0**：
   - 每个 Feature 必须含 `## 验证命令` 块（可执行命令，Evaluator 直接跑）
   - Phase 3 加 git commit + push（推 PRD 到 remote）
   - 删掉"合同协商"语言

2. **sprint-evaluator/SKILL.md v2.0**：
   - execSync 真实执行 PRD 里的每条验证命令
   - 记录 exit code + stdout → eval-round-N.md
   - 输出 JSON `{"verdict": "PASS/FAIL", "eval_round": N, "failed_scs": [...]}`
   - 删掉所有 readFileSync + includes 静态检查

3. **execution.js**：
   - 删掉 Layer 2（sprint_contract_propose/review 完整链路）
   - sprint_planner → 直接 sprint_generate
   - sprint_evaluate PASS → sprint_report（不走 arch_review）
   - 删掉 sprint_num 字段

4. **新建 sprint-report/SKILL.md v1.0**：
   - 读 DB 中所有 harness 任务
   - 统计：PRD 目标、eval 轮次、fix 清单、token/cost
   - 输出 sprint-report.md + git push
   - JSON `{"verdict": "DONE", ...}`

## 下次预防

- [ ] 设计新系统时先找官方论文/文档，不要自行发明中间阶段
- [ ] "无脑执行器"模式：Evaluator 的价值在于命令执行，不在于代码理解
- [ ] 广谱性设计：验证命令在 Planner 阶段写死，适用所有任务类型（curl/node/psql/bash）
- [ ] Harness 最终步骤必须有 report，记录成本和对抗记录
