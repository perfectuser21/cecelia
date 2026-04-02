---
id: dev-step-02-code
version: 7.0.0
created: 2026-03-14
updated: 2026-04-02
changelog:
  - 7.0.0: 精简 — 删除 Generator subagent、code_review_gate、独立 Evaluator。主 agent 直接写代码。
---

# Stage 2: Code — 探索 + 写代码 + 验证 DoD

> 主 agent 直接写代码，逐条验证 DoD。不经 subagent。

**Task Checkpoint**: `TaskUpdate({ taskId: "2", status: "in_progress" })`

---

## 2.1 探索代码

读取 Task Card 的「实现方案」部分，探索相关文件：

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
TASK_CARD=".task-${BRANCH_NAME}.md"
cat "$TASK_CARD"
```

**探索规则**：先读再改，理解现有代码，确认受影响的文件和函数。

---

## 2.2 写代码

直接修改代码文件，按 Task Card 实现方案执行。

**代码规范**：
- 不加多余注释、不加 console.log
- 不改 Scope 外的文件
- 单文件 > 500 行考虑拆分

---

## 2.3 逐条验证 DoD

**对 Task Card 每个 DoD 条目执行 Test 命令验证**：

```
对每个 DoD 条目：
  1. 运行 Test: 命令
  2. 通过 → 勾选 [x]
  3. 失败 → 修复代码 → 重新验证
  4. 全部 [x] → 进入 Stage 3
```

### 本地测试

```bash
cd packages/engine && npx vitest run <相关测试文件>
```

---

## 2.4 标记完成 + 持久化

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
sed -i '' 's/step_2_code: pending/step_2_code: done/' "$DEV_MODE_FILE"
git add "$DEV_MODE_FILE" && git commit -m "chore: [state] step_2_code: done"
```

---

## 完成后

**Task Checkpoint**: `TaskUpdate({ taskId: "2", status: "completed" })`

**继续 → Stage 3 (Integrate)** — 读取 `skills/dev/steps/03-integrate.md` 并执行。
