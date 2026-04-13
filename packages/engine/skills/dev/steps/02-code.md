---
id: dev-step-02-code
version: 8.0.0
created: 2026-03-14
updated: 2026-04-13
changelog:
  - 8.0.0: Superpowers 融入 — TDD 红绿循环 + Verification Gate + Systematic Debugging + 3 次失败升级
  - 7.1.0: Harness v2.0 适配 — harness_mode 下读 sprint-contract 写代码，跳过 DoD 逐条验证
  - 7.0.0: 精简 — 删除 Generator subagent、code_review_gate、独立 Evaluator。主 agent 直接写代码。
---

# Stage 2: Code — TDD 红绿循环 + 写代码 + 验证 DoD

> 使用 `superpowers:test-driven-development` 纪律写代码，用 `superpowers:verification-before-completion` 验证每个声明。

**Task Checkpoint**: `TaskUpdate({ taskId: "2", status: "in_progress" })`

---

## 0. Harness 模式检测（harness_mode）

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
HARNESS_MODE=$(grep "^harness_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")
```

### harness_mode = true 时

读 sprint-contract.md 作为实现指南，写代码，**不逐条验证 DoD**（Evaluator 来验）。

```bash
SPRINT_DIR=$(grep "^sprint_dir:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "sprints/sprint-1")
cat "${SPRINT_DIR}/sprint-contract.md"
```

**Harness 模式流程**：
1. 读 sprint-contract.md 理解验收标准和预计改动文件
2. 探索代码（先读再改）
3. 写代码实现（仍然遵守 TDD 纪律 — 先写测试再写实现）
4. 本地基本测试（lint + typecheck + 相关 vitest）
5. **跳过 DoD 逐条验证**（Evaluator 独立测试）
6. 标记 step_2_code: done
7. **直接进入 Stage 3 (Integrate)** — push + PR

完成后跳到 [2.5 标记完成](#25-标记完成--持久化)。

---

### harness_mode = false（默认流程）

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

## 2.2 TDD 红绿循环写代码

> **核心纪律来自 `superpowers:test-driven-development`：先红再绿，违反就删。**

### Iron Law（铁律）

```
没有失败的测试 → 不写实现代码
写了代码但没先写测试？→ 删掉代码，从测试重新开始
不是"参考"，不是"适配" → 是删除
```

### 对每个 DoD BEHAVIOR 条目，执行红绿循环：

```
RED（红）:
  1. 为这个行为写一个最小测试（或 Test: 命令）
  2. 运行测试 → 确认 FAIL
  3. 确认失败原因是"功能不存在"而非拼写错误
     测试通过了？→ 你在测试已有行为，换个测试

GREEN（绿）:
  4. 写最少的代码让测试通过
  5. 运行测试 → 确认 PASS
  6. 其他测试也通过？→ 不通过就修

REFACTOR（重构）:
  7. 去重、改名、提取函数
  8. 保持测试绿色
```

### Rationalization 防线（AI 常见借口及对策）

| 借口 | 现实 |
|------|------|
| "太简单不需要测试" | 简单代码也会坏。测试只要 30 秒 |
| "我先写完再补测试" | 事后测试通过了不代表测试有效 — 你没看到它失败过 |
| "手动测过了" | 手动测试无法重现、无法回归、无法 CI 执行 |
| "删掉 X 小时的工作太浪费" | 沉没成本谬误。保留不可信的代码才是浪费 |
| "先探索一下再 TDD" | 可以。但探索完删掉探索代码，用 TDD 重新写 |
| "这个改动只有一行" | 一行也能引入 bug。一行测试也很快 |
| "TDD 太慢了" | TDD 比事后调试快。先红再绿是最短路径 |

### 代码规范

- 不加多余注释、不加 console.log
- 不改 Scope 外的文件
- 单文件 > 500 行考虑拆分
- 不 over-engineer — 测试要什么就写什么，不多写

### Good vs Bad 测试

<Good>
```typescript
test('拒绝空邮箱', async () => {
  const result = await submitForm({ email: '' });
  expect(result.error).toBe('Email required');
});
```
清晰名称，测试真实行为，一次一个
</Good>

<Bad>
```typescript
test('测试邮箱', async () => {
  const mock = jest.fn().mockResolvedValue({ ok: true });
  await submitForm(mock);
  expect(mock).toHaveBeenCalled();
});
```
模糊名称，测试 mock 而非代码
</Bad>

### Testing Anti-Patterns（来自 `superpowers:test-driven-development`）

**禁止：**
- 测试 mock 的行为而非真实代码的行为
- 给生产类加 test-only 方法（放到测试工具里）
- 不理解依赖就 mock（先理解副作用再决定 mock 粒度）
- 不完整的 mock（遗漏的字段会静默失败）
- "代码写完了，该写测试了"（测试是实现的一部分，不是事后补充）

---

## 2.3 逐条验证 DoD + Verification Gate

> **仅非 Harness 模式执行此步骤。** Harness 模式由 Evaluator 独立验证。

### Verification Gate（来自 `superpowers:verification-before-completion`）

**在勾选任何 `[x]` 或声明"完成"之前，强制执行：**

```
BEFORE claiming any status:
  1. IDENTIFY — 什么命令能证明这个声明？
  2. RUN     — 执行完整命令（不是上次的结果）
  3. READ    — 读完整输出，检查 exit code
  4. VERIFY  — 输出确认了声明？
     YES → 勾选 [x]，附带证据
     NO  → 修复代码，重新验证
  5. ONLY THEN → 声明完成
```

**Red Flags — 出现这些词就停下跑命令：**
- "should pass"、"probably works"、"seems correct"
- "Great!"、"Perfect!"、"Done!" （没跑验证就不许说）
- "我有信心"（信心 ≠ 证据）
- "就这一次跳过"（没有例外）

### 逐条验证流程

```
对每个 DoD 条目：
  1. 运行 Test: 命令 → 记录 exit code 和输出
  2. exit 0 + 输出符合预期 → 勾选 [x]
  3. 失败 → 使用 Systematic Debugging（见 2.4）修复 → 重新验证
  4. 全部 [x] → 进入 2.5
```

### 本地测试

```bash
cd packages/engine && npx vitest run <相关测试文件>
```

---

## 2.4 调试纪律（Systematic Debugging）

> **当 DoD 验证失败或代码有 bug 时，使用 `superpowers:systematic-debugging` 流程。**

### 4 Phase 调试法

```
Phase 1: 根因调查（BEFORE attempting ANY fix）
  ① 仔细读错误信息 — 不要跳过，它通常包含答案
  ② 稳定复现 — 能可靠触发吗？每次都发生？
  ③ 检查最近改动 — git diff，什么变了？
  ④ 追踪数据流 — 坏的值从哪来？一层层回溯到源头

Phase 2: 模式分析
  找到类似的 working code，对比差异

Phase 3: 假设 + 最小测试
  一次只改一个变量，验证假设

Phase 4: 修复
  先写失败测试复现 bug → 修复 → 测试变绿
```

### 3 次失败升级规则

```
修复尝试 ≤ 2 次: 正常流程 — 回到 Phase 1 重新分析
修复尝试 = 3 次: 停下来质疑架构本身
  → 这不是"假设错了"，是"方向错了"
  → 问：这个设计模式是否根本不适合？
  → 问：是否需要重构而非修补？
  → 如果不确定，使用 superpowers:dispatching-parallel-agents 派 subagent 独立分析
```

**Rationalization 防线：**

| 借口 | 现实 |
|------|------|
| "快速修一下先" | 随机修复浪费时间，制造新 bug |
| "应该是 X 的问题" | "应该"不是证据，跑一遍确认 |
| "再试一次修" | 第 3 次了？停下来质疑架构 |
| "太紧急了没时间调查" | 系统化调试比瞎试快 |

---

## 2.5 标记完成 + 持久化

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
sed -i '' 's/step_2_code: pending/step_2_code: done/' "$DEV_MODE_FILE"
# .dev-mode 不提交到 git（.gitignore 已排除），只保留在本地
```

---

## 完成后

**Task Checkpoint**: `TaskUpdate({ taskId: "2", status: "completed" })`

**继续 → Stage 3 (Integrate)** — 读取 `skills/dev/steps/03-integrate.md` 并执行。
