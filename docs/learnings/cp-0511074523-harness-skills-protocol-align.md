# Learning — harness skills 协议对齐修订

**日期**: 2026-05-11
**分支**: cp-0511074523-harness-skills-protocol-align
**类型**: [CONFIG]（4 个 SKILL.md 协议对齐）

## 背景

PR A #2879 + PR B #2880 合并后，派 W22 验证修复链路。W22 task=failed（PR B 修复 verdict 传递有效），但 evaluator 4 次 sub-task FAIL 全是同一个 reason："contract-dod-ws1.md 0 条 [BEHAVIOR] 标签"。

User 反馈："你说是 LLM 的问题，那就是你 skill 没写好"——架构没问题，是我 PR A 修订时只改了 evaluator skill，没回头看 proposer 跟它协议是否一致。

### 根本原因

PR A v1.1 evaluator SKILL 加了反作弊红线第 3 条："缺 [BEHAVIOR] Test 命令直接 FAIL"，找的是 contract-dod-ws*.md 文件里的 [BEHAVIOR] 标签条目。

但 proposer SKILL Step 2b（PR A 没改的部分）写的是：
> | [BEHAVIOR] | `tests/ws{N}/*.test.ts` 的 `it()` 块 |

proposer 严格遵守自己 SKILL 把 BEHAVIOR 拆到 vitest 文件，contract-dod-ws*.md 里只放 [ARTIFACT] + 一个 `## BEHAVIOR 索引` 段指向 vitest。Evaluator 找不到 [BEHAVIOR] 标签 → 直接 FAIL。

**两个 skill 协议互相矛盾，proposer 跟 evaluator 永远满足不了对方**。

同时观察到：
- planner v8.1 加了 Response Schema 段但没强约束 query param 名 → W22 generator 用 a/b 不用 base/exp
- reviewer v6.1 第 6 维只评 verification_oracle_completeness，不卡 [BEHAVIOR] 数量 → R1 直接 APPROVED 25:0 极端不平衡合同
- generator SKILL 没要求 push 前自验 contract → 推弱实现给 evaluator 兜底浪费 retry 周期

### 下次预防

- [x] 改 SKILL prompt 时**必须回头看相关协议方** — 加了 evaluator 找 X，必须确认 proposer 写 X，否则协议矛盾
- [x] 每个 skill 改完 SKILL.md 必须脑跑一次："如果上下游 LLM 严格执行各自 SKILL，能不能达成预期？"
- [x] PRD Response Schema 段必须含 Query Parameters 子段（query 名约束跟 response 字段同等重要）
- [x] Reviewer rubric 维度要包含"数量与位置"硬阈值，不只是"质量"评分（避免 0:N 极端不平衡）
- [x] Generator 必须有 push 前自验步骤——把 evaluator 的 oracle 命令在 push 前先跑一遍，FAIL 不准 push
- [x] 每条新 skill 改动必须配 W 任务 acceptance test（不能合并就当过）

## 修复内容

| Skill | 版本 | 改动 |
|---|---|---|
| harness-contract-proposer | v7.3 → v7.4 | DoD 分家规则：BEHAVIOR 改放 contract-dod-ws*.md 内嵌 manual:bash；Step 2b 模板加 ≥ 4 条 [BEHAVIOR] 严示例 |
| harness-planner | v8.1 → v8.2 | Response Schema 段加 Query Parameters 子段（query 名约束 + 禁用别名清单）|
| harness-contract-reviewer | v6.1 → v6.2 | Rubric 加第 7 维 behavior_count_position（≥ 4 条 [BEHAVIOR] 内嵌 manual:bash 硬阈值）|
| harness-generator | v6.0 → v6.1 | 加 Step 6.5 Contract Self-Verification（push 前自跑 manual:bash 全过，FAIL 不准 push）|

## Anthropic 哲学对齐

Anthropic harness-design 第 4 条警告：
> "Out of the box, Claude is a poor QA agent...even evaluator needs prompt engineering"

我们 PR A 加了 evaluator prompt 严格化（反作弊红线），但忽视了"proposer 跟 evaluator 必须对同一个数据结构沟通"。Skill 是协议，协议方必须双向对齐。本 PR C 修复这个对齐缺失。

## 验收锚点

PR 合并后派 W23 严 schema 任务：
- 期望 1：proposer v7.4 输出 contract-dod-ws*.md 含 ≥ 4 条 [BEHAVIOR] manual:bash 命令
- 期望 2：reviewer v6.2 第 7 维 behavior_count_position ≥ 7 → APPROVED
- 期望 3：generator v6.1 Step 6.5 self-verify 全过，push 前不漂移
- 期望 4：evaluator v1.1 跑同一套 manual:bash → 全 PASS → task=completed
- 期望 5：AI 主理人独立 curl → 严 schema 真匹配

5 项全到位 = "工厂治本到位 + 输出严守合规品"。
