# PRD — [CONFIG] harness skills Anthropic harness-design 对齐

## 背景 / 问题

W19 + W20 实证 harness pipeline 端到端跑通 status=completed，但**实际交付**有 schema drift：

- W19 PRD 写 `{result:5}`，generator 返 `{sum:5}`，sub-evaluator PASS（漏判）
- W20 PRD 严写 `{result:35, operation:"multiply"}` 含禁用字段清单，generator 返 `{product:35}`，sub-evaluator PASS（漏判）

3 层 audit 后定位 4 bug 中 3 个根因（Bug 1/2/4）位于 skill 层（planner 缺 schema 段 + reviewer 缺第 6 维 verification oracle 完整性 + evaluator 缺反作弊红线 + proposer 缺 schema codify 强制规则）。

对齐 Anthropic 官方文章 [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)：
> "separating the agent doing the work from the agent judging it proves to be a strong lever"
> "the evaluator used the Playwright MCP to click through the running application the way a user would"

我们 generator/evaluator 已分离，但 evaluator 默认信 vitest pass 当 verdict（vitest 是 generator 自写）→ 等于把 QA 的判定权交给开发员。本 PR 通过 4 个 skill 的 prompt 修订把 oracle 链条补齐：planner 必须写 schema → proposer 必须 codify schema 成 jq -e → reviewer 第 6 维审 codify 完整性 → evaluator 真跑 jq -e 不信 vitest。

## 成功标准

- **SC-001**: harness-planner SKILL.md 含"## Response Schema（API 任务必填）"模板段
- **SC-002**: harness-contract-reviewer SKILL.md rubric 含第 6 维 `verification_oracle_completeness`，threshold 规则同步从 5 维改成 6 维
- **SC-003**: harness-evaluator SKILL.md 含"反作弊红线"段，明示禁止把 vitest passed 当 PASS、缺 [BEHAVIOR] 直接 FAIL
- **SC-004**: harness-contract-proposer SKILL.md 验证命令写作规范段含"Response Schema → jq -e codify 强制规则"表 + 完整严合规示例
- **SC-005**: 4 个 skill version bump + changelog 写明对齐 Anthropic harness-design + W19/W20 实证根因
- **SC-006**: 派 W21 严 schema /multiply 重测：generator 仍漂移 → reviewer 第 6 维卡住 REVISION → 或 evaluator jq -e exit 1 → FAIL（不再假 PASS）

## 范围限定

**在范围内**：
- packages/workflows/skills/harness-planner/SKILL.md（v8.0 → v8.1）
- packages/workflows/skills/harness-contract-reviewer/SKILL.md（v6.0 → v6.1）
- packages/workflows/skills/harness-evaluator/SKILL.md（v1.0 → v1.1）
- packages/workflows/skills/harness-contract-proposer/SKILL.md（v7.2 → v7.3）

**不在范围内**：
- packages/brain/src/executor.js verdict 传递修复（Bug 3，单独 PR B）
- 加 verify_deployment 节点（PR C，可选 P2）
- 改 LangGraph 节点定义
- packages/engine 任何文件

## 不做

- 不改 Brain runtime 代码（.js）
- 不改 LangGraph orchestrator
- 不改 CI workflow
- 不动 generator skill（v6.0 已 fully aligned per audit）
- 不动 dev pipeline skills（engine-worktree 等）

## 测试策略

- **Unit tests**: SKILL.md 是 Markdown 配置文件，无可单测的代码逻辑。Trivial wrapper exemption.
- **Integration / E2E**: 派 W21 harness_initiative 真跑严 schema /multiply 任务作为 acceptance test
  - 验 reviewer 第 6 维真起作用（contract 缺 jq -e → REVISION）
  - 验 evaluator 反作弊真起作用（generator 漂移 → jq -e exit 1 → FAIL）
- **smoke.sh**: N/A — packages/workflows/skills/ 不在 packages/brain/src/ 范围（v18.7.0 规则只适用 brain runtime）

## 受影响文件

- `packages/workflows/skills/harness-planner/SKILL.md`
- `packages/workflows/skills/harness-contract-reviewer/SKILL.md`
- `packages/workflows/skills/harness-evaluator/SKILL.md`
- `packages/workflows/skills/harness-contract-proposer/SKILL.md`
- `docs/learnings/cp-0510203649-harness-skills-anthropic-align.md`
- `PRD.md` + `DoD.md`（worktree 根 + packages/workflows/）
