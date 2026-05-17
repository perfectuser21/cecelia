# Learning: Sprint Contract Gate 重设计 — 双独立提案架构

**分支**: cp-03310837-adversarial-redesign
**日期**: 2026-03-31

---

### 根本原因

Sprint Contract Gate 的"独立性"是信息污染的假独立：

1. **Planner 越权写 Test 字段**：planner-prompt.md 的 [GATE] 条目有非 TODO 的 Test 命令，开了允许 Planner 写 Test 的口子
2. **Evaluator 收到含答案的试卷**：spec_review subagent 收到的 Task Card 包含主 agent 已填写的 Test 字段，然后被要求"假装不看"独立提案——LLM 看到了答案不可能真正独立
3. **Sprint Contract 里的 Generator 是主 agent 本人**：主 agent 有完整上下文，自己填 Test 字段再让 Evaluator 比对，本质是左手打右手

divergence_count >= 1 的规则是一个补丁，强制 Evaluator 找茬，但根本问题（信息污染）没有解决。

---

### 下次预防

- [ ] 凡是"独立"比对的场景，必须在 prompt 构建阶段机械保证信息隔离，不能靠"LLM 自我约束"
- [ ] Planner 的输出格式不应允许任何 Test 命令，用 grep/验证脚本确认而不是靠 prompt 规则
- [ ] 任何"X 不看 Y 的输出"的设计，必须问：X 的输入里有没有 Y 的输出？如果有，独立性已经破坏

---

### 修复方案总结

**剥离机制**：Orchestrator 在调用 Generator subagent 和 Evaluator subagent 之前，将 Task Card 所有 Test 字段替换为 TODO，传入的是剥离版。两者从零独立提案，不可能被污染。

**N 轮收敛**：Orchestrator 比对两份提案 → 有 blocker 分歧 → 将对方提案展示给各自 → 各自修正 → 最多 3 轮。

**Planner 边界**：planner-prompt.md 所有 Test 字段改为 TODO，包括 [GATE] 条目。
