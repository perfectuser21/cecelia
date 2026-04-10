# Sprint PRD — Harness Self-Check v2：验证 Reviewer 对抗证伪机制的有效性

## 背景

Reviewer v4.4 在 changelog 中声称新增了"对抗证伪机制"：对每条 Test 命令构造"最懒假实现"，判断命令能否被绕过。但这个机制从未在受控实验中被系统性验证过——我们不知道它是否真的能识别弱命令、是否真的会触发 REVISION、以及 GAN 轮次是否因此变多变严格。

本 sprint 的目标是用 harness 系统对自身的 SKILL.md 运行一轮 GAN 对抗，以观察 Reviewer 证伪机制的实际效果。

## 目标

对现有 harness SKILL.md（harness-contract-proposer 和 harness-contract-reviewer 的行为描述）发起一次完整 GAN 对抗，验证 Reviewer v4.4 的对抗证伪机制是否真正有效。

## 功能列表

### Feature 1: Proposer 为 harness 本身生成合同草案

**用户行为**: Proposer 读取 harness 系统（Proposer + Reviewer SKILL.md）的行为描述，产出一份合同草案，包含每个功能点的验证命令。

**系统响应**:
- 合同草案覆盖 Proposer 和 Reviewer 的核心行为（读 PRD、输出草案、对抗分析、写 feedback）
- 每个功能点有可执行的 Test 命令（node/curl/bash 格式）
- 合同包含 `## Workstreams` 区块，至少 2 个 workstream

**不包含**: 不验证命令是否足够强——这是 Reviewer 的职责

---

### Feature 2: Reviewer 对草案中每条命令执行对抗证伪分析

**用户行为**: Reviewer 收到合同草案后，对每条 Test 命令构造"最懒假实现"并判断能否绕过。

**系统响应**:
- 每条 Test 命令对应一个三元组输出：`命令 / 最懒假实现 / 能否绕过 + 理由`
- 任意命令"能否绕过: YES"→ 整份草案判定为 REVISION，反馈中包含完整证伪分析
- 全部命令"能否绕过: NO"→ 继续其他维度检查（CI 白名单、Workstream 完整性等）
- Reviewer 不允许主观判断替代证伪构造（不能"感觉命令够严格"就 APPROVE）

**不包含**: 不要求 Reviewer 自己修改命令——只输出判断和建议

---

### Feature 3: GAN 轮次因证伪机制变多且每轮更严格

**用户行为**: Proposer 根据 Reviewer 的证伪反馈修订命令，Reviewer 再次对新命令构造假实现。

**系统响应**:
- 修订轮的 Test 命令相比前一轮必须更严格（可从 feedback 中追踪）
- GAN 至少经历 2 个完整轮次（1 次 REVISION + 1 次对修订版的再审）
- 最终 APPROVED 的合同中，所有命令均已通过"能否绕过: NO"验证
- 每轮 Reviewer 的证伪输出格式一致，可对比观察轮次演化

**不包含**: 不限制 GAN 最大轮次（无上限是刻意设计）

---

### Feature 4: 最终产出可观察的验证报告

**用户行为**: GAN 结束后，可从产物文件中完整还原对抗过程。

**系统响应**:
- `sprint-contract.md`：最终 APPROVED 合同
- `contract-review-feedback.md`（各轮）：包含每轮证伪分析和必须修改项
- 各轮 `contract-draft.md`：对比修订前后命令的变化
- 可从文件中明确判断：Reviewer 确实发现了弱命令（第 1 轮至少 1 个 YES）

**不包含**: 不要求自动生成对比报告——人工阅读文件即可验证

---

## 成功标准

- **标准 1**: 第 1 轮 Reviewer 在证伪分析中发现至少 1 条"能否绕过: YES"命令，并正确输出 REVISION
- **标准 2**: REVISION 反馈包含完整三元组（命令 / 最懒假实现 / YES + 理由），而非仅描述问题
- **标准 3**: GAN 经历至少 2 轮（第 1 轮 REVISION → 第 2 轮对修订版重新证伪）
- **标准 4**: 最终 APPROVED 合同中所有命令均通过"能否绕过: NO"验证（有明确记录）
- **标准 5**: 产物文件完整存在于 `sprints/harness-self-check-v2/` 下

## 范围限定

**在范围内**:
- 对 harness-contract-proposer 和 harness-contract-reviewer 的行为进行 GAN 对抗
- 观察 Reviewer 证伪机制是否触发 REVISION
- 记录每轮证伪分析的完整输出

**不在范围内**:
- 修改 Reviewer/Proposer 的 SKILL.md（这是验证，不是改造）
- 评估 harness-generator 或 harness-evaluator 的行为
- 自动化持续运行（本 sprint 只跑一次受控实验）

## 预期受影响文件

- `packages/workflows/skills/harness-contract-proposer/SKILL.md`：被测对象，Proposer 读取此文件行为描述后生成合同草案（只读，不修改）
- `packages/workflows/skills/harness-contract-reviewer/SKILL.md`：被测对象，Reviewer v4.4 证伪机制的实现来源（只读，不修改）
- `sprints/harness-self-check-v2/sprint-prd.md`：本文件，Planner 产出
- `sprints/harness-self-check-v2/contract-draft.md`：Proposer 产出的合同草案（各轮）
- `sprints/harness-self-check-v2/contract-review-feedback.md`：Reviewer 各轮反馈（含证伪分析）
- `sprints/harness-self-check-v2/sprint-contract.md`：最终 APPROVED 合同
