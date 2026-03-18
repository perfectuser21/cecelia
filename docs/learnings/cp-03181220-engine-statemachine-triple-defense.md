# Learning: Engine 状态机三层防御 P0+P1

**分支**: cp-03181220-engine-statemachine-triple-defense
**日期**: 2026-03-18
**PR**: feat(engine): 状态机三层防御 P0+P1

---

### 根本原因

原有单层防御（branch-protect.sh PreToolUse:Write/Edit）存在两条绕过路径：

1. **Bash 工具绕过**：AI 通过 `Bash` 工具运行 `echo "step_2_code: done" >> .dev-mode.*`，完全绕过 PreToolUse:Write Hook，可以在无真实代码改动时标记步骤完成。

2. **Stop Hook 无验签**：Stop Hook 只检查 `.dev-mode` 文件中的 `step_N: done` 标记，但无法验证这些标记是否经过 verify-step.sh 真实验证。伪造的 done 标记可以通过完成条件检查。

本质：单点拦截 + 无签名验证 = AI 可以通过多路绕过完成状态机约束。

---

### 解决方案（三层防御架构）

| 层 | 位置 | 触发时机 | 防御内容 |
|----|------|----------|----------|
| **Layer 1** | branch-protect.sh (PreToolUse:Write/Edit) | Write/Edit 工具写 .dev-mode | 调用 verify-step.sh 验证 |
| **Layer 1b** | bash-guard.sh (PreToolUse:Bash) | Bash 工具写 .dev-mode | Rule 5 检测并调用 verify-step.sh |
| **Layer 2** | stop-dev.sh (Stop Hook) | 会话结束时 | 检查 .dev-seal 验签完整性 |

**验签机制**：verify-step.sh 通过验证后，将 `${STEP}_seal: verified@timestamp` 写入 `.dev-seal.${BRANCH}` 文件，Stop Hook 在完成条件检查之前先验证所有已标记为 done 的步骤都有对应验签。

---

### 下次预防

- [ ] 新增状态文件（.dev-*）操作时，优先分析是否存在通过 Bash 工具的绕过路径
- [ ] Hook 防御设计时考虑多工具路径（Write/Edit/Bash）
- [ ] 重要状态变更应引入密封/签名机制，而非单纯依赖文件存在检查
- [ ] bash-guard.sh 新增规则时，确认 beforeAll 中已复制所有依赖文件（verify-step.sh 等）
- [ ] stop-dev-seal.test.ts 中的 `STOP_DEV_PATH = resolve(__dirname, "../../hooks/stop-dev.sh")` 模式是 RCI testImportsSourceFile 检查通过的必要条件
