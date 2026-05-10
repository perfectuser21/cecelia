# Learning — harness skills 对齐 Anthropic harness-design

**日期**: 2026-05-10
**分支**: cp-0510203649-harness-skills-anthropic-align
**类型**: [CONFIG]（4 个 SKILL.md prompt 修订）

## 背景

W19 + W20 实证 harness pipeline 端到端 status=completed，但实际交付有 schema drift（W19 result→sum / W20 result→product），sub-evaluator 漏判。3 层 audit 后定位 4 bug 中 3 个根因（Bug 1/2/4）位于 skill prompt 层，本 PR 修 4 处 SKILL.md。Bug 3（executor.js verdict 传递）由独立 PR B 修。

### 根本原因

evaluator/generator 已结构性分离（不同 docker container + 不同 skill），但 evaluator 默认信 generator 自写的 vitest "passed" 当 verdict 替代物——等于把 QA 判定权交给开发员，**defeat 了 generator/evaluator 分离的全部意义**。

链条：
- **planner v8.0 缺 Response Schema 段** → PRD 没字面 codify 字段名/类型/禁用清单
- **proposer v7.2 缺 schema codify 强制规则** → 合同的 jq -e 命令没强制 enforce 每个字段（只 `curl -f` 看 HTTP 200，没 `jq -e '.result == val'`）
- **reviewer v6.0 rubric 5 维不审 verification oracle 完整性** → 弱合同也能 APPROVED
- **evaluator v1.0 没明示禁止信 vitest pass** → 跑了软合同也给 PASS

## 修复路径

对齐 Anthropic 官方 [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps) 原话：
> "separating the agent doing the work from the agent judging it proves to be a strong lever"
> "the evaluator used the Playwright MCP to click through the running application the way a user would"

把 oracle 链条补齐：
1. **planner** v8.0 → v8.1：加 "## Response Schema（API 任务必填）" 段，强制 PRD codify 字段
2. **proposer** v7.2 → v7.3：加 "Response Schema → jq -e codify 强制规则" 表 + 严合规示例 + 反例
3. **reviewer** v6.0 → v6.1：rubric 加第 6 维 `verification_oracle_completeness`，threshold 从 5 维 ≥ 7 改 6 维 ≥ 7
4. **evaluator** v1.0 → v1.1：加"反作弊红线"段，4 条硬规：禁信 vitest passed / 禁读源码判 / 缺 [BEHAVIOR] 直接 FAIL / 缺 jq -e 记入 feedback

### 下次预防

- [x] PRD `## Response Schema` 段必须含具体 JSON 示例 + 字段约束 + 禁用清单（不允许仅自然语言）
- [x] Contract 每个 PRD 字段必须配 1 条 `jq -e '.key == val'` 命令
- [x] Contract 必须含 schema 完整性卡 `jq -e 'keys == [...]'`（不许多 key 不许少 key）
- [x] Contract 必须含禁用字段反向检查 `! has("禁用key")`
- [x] Reviewer 第 6 维 < 7 直接 REVISION，不让弱合同混过
- [x] Evaluator 跑 [BEHAVIOR] Test 命令真 exit 1 才 FAIL，禁止把 vitest passed 当 PASS 替代

## Anthropic 哲学对齐

我们 4 个 skill 修复后，Cecelia harness pipeline 跟 Anthropic 推荐架构 95% 对齐：
- ✅ generator/evaluator 分离（多 docker container）
- ✅ contract 在 code 之前由 GAN 协商（proposer + reviewer）
- ✅ contract 是 oracle，不是 generator 自写测试（v6.1 rubric 强制）
- ✅ evaluator 用真工具（curl + jq -e + psql + node）跑真应用（v1.1 强制）
- ✅ evaluator 默认会过度通过 → prompt 工程严格化（v1.1 反作弊红线）

剩 5% 是 PR C verify_deployment 节点（可选纵深防御）+ Bug 3 executor.js verdict 传递（独立 PR B）。

## 验收锚点

PR 合并后派 W21 严 schema /multiply 重测：
- 期望 1：generator 漂移到 product → reviewer 第 6 维 catch 在合同阶段
- 期望 2：generator 漂移到 product 但 reviewer 漏 catch → evaluator 跑 jq -e exit 1 → FAIL
- 期望 3：task status=failed（**前提**：PR B executor.js 修了 verdict 传递）
