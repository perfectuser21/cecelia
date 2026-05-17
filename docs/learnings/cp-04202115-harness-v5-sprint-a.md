# Learning — Harness v5 Sprint A: Proposer / Reviewer 升级

### 根本原因

Harness v4.x 的 DoD 用 `node -e "readFileSync + 正则"` 这类字符串检查充当 BEHAVIOR 测试，Generator 可以"写实现 + 让 grep 过"而不真的实现功能。Reviewer v4.4 虽有 Triple Mutation 挑战机制，但只打到"命令"层（挑战 `curl` 或 `grep` 是否能蒙过），打不到"测试代码本身"——因为根本没有测试代码。

Sprint A 的修法：

1. **让 Proposer 产出真实 vitest 测试文件** 作为合同的一部分（`tests/ws{N}/*.test.ts`）。测试代码进入 GAN 对抗
2. **让 Reviewer 挑战测试代码**（Mutation testing）：对每个 `it()` 块构造 `fake_impl`——能否写假实现让测试通过但行为错？能构造出来 → REVISION
3. **DoD 分家**：静态 ARTIFACT 留 `contract-dod-ws{N}.md`，运行时 BEHAVIOR 搬进 `.test.ts`。两者用不同工具验证（fs 检查 vs vitest）
4. **Red 证据实跑**：Reviewer 不信 Proposer 贴的 Red log，自己 `git checkout` + `npx vitest` 实际跑一遍

### Reviewer 心态硬化（防退化）

写进 SKILL.md 非协商：

- 默认 REVISION，除非证据充分才 APPROVED
- 80% Triple 覆盖率是**下限**不是目标
- GAN 轮次**无上限**，不因"已经几轮了"就放过
- 对每个 `it()` 都必须尝试构造 `fake_impl`

禁用一切让 Reviewer 变温和的妥协机制。

### 下次预防

- [ ] 未来写新 skill 流程时，区分 [ARTIFACT]（文件级检查）和 [BEHAVIOR]（运行时测试），不要让 BEHAVIOR 降级成 grep
- [ ] GAN 对抗无上限 + Reviewer picky 心态要写进 SKILL.md 非协商条款，不靠 AI 自觉
- [ ] 合同产物必须可独立验证（Proposer 写的测试，Reviewer 必须能 checkout 跑一遍）
- [ ] 结构性测试（读 SKILL.md 检查章节）是 prompt engineering 的唯一自动化防护，必须补全
- [ ] Sprint B 的 Generator 改造完成后，才能端到端跑完整 Propose → Review → Generate → Evaluator 链路；Sprint A 的 dogfood 要合并后再做

### 关键设计决策记录

**为什么不用 superpowers:subagent-driven-development？**
因为 memory `feedback_no_agent_bypass_dev.md` 禁止用 Agent(isolation:"worktree") 直接改代码 push。本 Sprint A 走 executing-plans inline 执行，遵守 /dev 流程（worktree + `.dev-mode.<branch>`）。

**为什么 Sprint B 里 Generator 不用 code-review-gate？**
simplify 功能已被 TDD 的 "GREEN - Minimal Code" + "REFACTOR - Clean Up" 阶段覆盖；requesting-code-review 的 subagent 也会 flag 冗余。单一审查门禁降低延迟和解释空间。

**为什么测试文件路径是 `sprints/{sprint}/tests/ws{N}/`？**
放在 sprint 目录下而非主测试树，不污染全局。Generator 实现时不移动，就地跑。vitest include pattern 留到 Sprint C 加。
