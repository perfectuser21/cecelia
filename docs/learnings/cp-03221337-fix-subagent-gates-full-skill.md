---
branch: cp-03221337-fix-subagent-gates-full-skill
date: 2026-03-22
task: 修复 /dev subagent gates 质量完整性
---

# Learning: 「只换引擎、不减步骤」的迁移原则

## 背景

PR #1330 将 spec_review 和 code_review_gate 从 Codex async dispatch 迁移到 Agent subagent 同步调用，正确解决了有头模式 stop hook 卡死问题。但同时犯了两个错误：

1. 删除了 devloop-check.sh 中的条件 1.5/2.5（读 Brain API 的版本），忘记补上读 .dev-mode 的新版本
2. 保留了 01-spec.md / 02-code.md 中的「3次FAIL → 降级写入 pass」逻辑

结果：两个审查门禁从「代码强制」退化为「AI 自觉」——subagent 跑没跑、PASS 没 PASS，devloop-check 完全不感知。

### 根本原因

**迁移架构时，只关注了「前向路径」（如何触发审查），忘记了「后向路径」（devloop-check 如何验证审查已通过）。**

前向路径：从 Codex dispatch 改为 subagent 调用 ✅
后向路径：devloop-check.sh 的条件 1.5/2.5 被删除，没有对应补回 ❌

### 下次预防

- [ ] 任何涉及「状态写入」机制的改动，必须同时检查「状态读取/验证」侧是否同步更新
- [ ] devloop-check.sh 是状态机的 SSOT，改 pipeline 流程时必须同步更新 devloop-check.sh
- [ ] 迁移时的 checklist：写入端（subagent 写 .dev-mode）→ 读取端（devloop-check 读 .dev-mode）→ 两端必须同时存在
- [ ] 降级 pass 逻辑（fail → 自动写 pass）是「AI 自觉」的典型形式，一旦发现立即删除
- [ ] 测试文件（devloop-check-pr-timing.test.ts）里的「not.toContain('条件 1.5')」是负面测试，迁移后要立即翻转

## 修复内容

1. **devloop-check.sh**：加回条件 1.5（`spec_review_status == blocked → return 2`）和条件 2.5（`code_review_gate_status == blocked → return 2`）。字段不存在时 pass-through（防死锁）。
2. **01-spec.md**：删除降级 pass，`retry_count >= 3` 改为写入 `spec_review_status: blocked`
3. **02-code.md**：删除降级 pass，`retry_count >= 3` 改为写入 `code_review_gate_status: blocked`
4. **测试**：devloop-check-gates.test.ts 加回 1.5/2.5 存在性与内容测试；devloop-check-pr-timing.test.ts 将「不含 1.5/2.5」翻转为「含 1.5/2.5 且顺序正确」

## 架构兼容性（无死锁）

- 正常路径：subagent 同步执行 → PASS → 主 agent 写入 `spec_review_status: pass` → 继续（不走 stop hook）
- 异常路径：3次 FAIL → 写入 `blocked` → devloop-check 触发人工介入
- pass-through：字段不存在时（subagent 尚未运行）devloop-check 默认通过，不误杀
