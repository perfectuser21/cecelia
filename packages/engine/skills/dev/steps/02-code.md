---
id: dev-step-02-code
version: 9.4.0
created: 2026-03-14
updated: 2026-04-16
changelog:
  - 9.4.0: F3 — 补 Superpowers 三个核心纪律到 Implementer prompt（Condition-Based Waiting / Pre-Completion Verification / Root-Cause Tracing），对齐 Superpowers 5.0.7 systematic-debugging + verification-before-completion
  - 9.3.0: autonomous 分支 Implementer 派遣时机改为来自 Superpowers subagent-driven-development skill，Research Subagent 处理 user 交互
  - 9.2.0: Implementer 开始前读 .decisions-<branch>.yaml 作为硬约束；Spec Reviewer 核心检查 5 验决策一致性
  - 9.1.0: Subagent Implementer/Reviewer 加全套回归强制规则（改 hooks/→跑 tests/hooks/ 全套，防止只跑新测试漏 T4 冲突）
  - 9.0.0: 新增 autonomous_mode — Subagent 三角色全自动（Implementer + Spec Reviewer + Code Quality Reviewer），失败自愈，Verification Gate
  - 7.1.0: Harness v2.0 适配 — harness_mode 下读 sprint-contract 写代码，跳过 DoD 逐条验证
  - 7.0.0: 精简 — 删除 Generator subagent、code_review_gate、独立 Evaluator。主 agent 直接写代码。
---

# Stage 2: Code — 探索 + 写代码 + 验证 DoD

> 主 agent 直接写代码，逐条验证 DoD。不经 subagent。

**Task Checkpoint**: `TaskUpdate({ taskId: "2", status: "in_progress" })`

---

## 0. 模式判断（harness / autonomous / standard）

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
HARNESS_MODE=$(grep "^harness_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")
AUTONOMOUS_MODE=$(grep "^autonomous_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")
```

- `harness_mode = true` → 走 **Section 1**
- `autonomous_mode = true` → 走 **Section 2**
- 其他 → 走 **Section 3**（standard）

---

## 1. harness_mode = true 时

读 sprint-contract.md 作为实现指南，写代码，**不逐条验证 DoD**（Evaluator 来验）。

```bash
SPRINT_DIR=$(grep "^sprint_dir:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "sprints/sprint-1")
cat "${SPRINT_DIR}/sprint-contract.md"
```

**Harness 模式流程**：
1. 读 sprint-contract.md 理解验收标准和预计改动文件
2. 探索代码（先读再改）
3. 写代码实现
4. 本地基本测试（lint + typecheck + 相关 vitest）
5. **跳过 DoD 逐条验证**（Evaluator 独立测试）
6. 标记 step_2_code: done
7. **直接进入 Stage 3 (Integrate)** — push + PR

完成后跳到 [完成后](#完成后)。

---

## 2. autonomous_mode = true 时（Subagent 三角色全自动）

**v9.3.0 autonomous 分支变化**:
autonomous_mode=true 时, Implementer subagent 派遣仍由主 agent 做,
但触发时机来自 Superpowers `subagent-driven-development` skill 而非本 step 直接。
Research Subagent 处理 Superpowers 链中的 user 交互, Implementer 做实际实现。

主 agent 作为协调者，对 `.plan-${BRANCH}.md` 的每个 task 派 3 轮 subagent。

### 2.1 前置准备

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
PLAN_FILE=".plan-${BRANCH_NAME}.md"
TASK_CARD=".task-${BRANCH_NAME}.md"
[[ ! -f "$PLAN_FILE" ]] && echo "ERROR: plan 文件缺失，回 Stage 1 重做" && exit 1
```

读 `.plan-${BRANCH}.md` 提取每个 task 的完整描述（不让 subagent 自己读文件，controller 传 full text）。

### 2.2 Round 1: Implementer Subagent

**使用 `superpowers:test-driven-development` 纪律 + `superpowers:verification-before-completion`**

**开始前读 .decisions-<branch>.yaml（来自 Step 0.7）：**
```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
DECISIONS_FILE=".decisions-${BRANCH_NAME}.yaml"
if [[ -f "$DECISIONS_FILE" ]]; then
    echo "[Implementer] 读取决策约束..."
    cat "$DECISIONS_FILE"
fi
```
- 每个决策是硬约束，实现不能违背
- 若决策要求"用 PostgreSQL"，Implementer 绝不能选 MongoDB
- matched decisions 中的每条选择必须在代码中落实

输入 prompt 模板（参考 `superpowers:subagent-driven-development/implementer-prompt.md`）：
- Task 完整描述（从 plan 复制，包括所有 Step）
- 相关代码上下文（主 agent 筛选）
- TDD 要求：先红再绿
- 4 种返回状态约定

**4 种状态 + 主 agent 行为**：

| 状态 | 含义 | 主 agent 行为 |
|------|------|--------------|
| `DONE` | 完成 | 进 Round 2 |
| `DONE_WITH_CONCERNS` | 完成但有疑虑 | 读疑虑决定 |
| `NEEDS_CONTEXT` | 缺信息 | 补 context 重派（同模型） |
| `BLOCKED` | 搞不定 | 见 2.5 失败自愈 |

**相关目录全套回归（强制）**:

Implementer 写完代码后，不仅要跑新写的 test，还必须跑"相关目录全套"回归：

| 改动类型 | 必跑目录 |
|---------|---------|
| `packages/engine/hooks/*.sh` | `tests/hooks/` 全套 |
| `packages/engine/lib/*.sh` | `tests/scripts/` + `tests/engine/` 全套 |
| `packages/engine/skills/dev/scripts/*.sh` | `tests/scripts/` 全套 |
| `packages/engine/skills/dev/steps/*.md` | `tests/dev/` + `tests/skills/` 全套 |
| `.github/workflows/*.yml` | `tests/workflows/` 全套 |

命令示例：
`npx vitest run tests/hooks/` 返回 0 failed 才能报 DONE.

**禁止**只跑新增 test 就报 DONE — PR #2338 self-heal vs T4 冲突就是这么漏的。

**Model 选择**：
- 改 1-2 文件 + plan 清晰 → Sonnet
- 多文件集成 / 需全局理解 → Opus

### 2.3 Round 2: Spec Reviewer Subagent

**核心原则**：**不信任 Implementer 的报告。自己读代码验证。**

输入 prompt（参考 `superpowers:subagent-driven-development/spec-reviewer-prompt.md`）：
- 任务要求（plan 中的 task 描述）
- Implementer 声称做了什么
- 指令："不要信任 Implementer 的报告。自己读代码逐行对比。"

**检查维度**：
1. **缺失的需求** — task 要求了但没实现
2. **多余的实现** — task 没要求但加了
3. **理解偏差** — 方向对不对

**输出**：
- ✅ Spec Compliant → 进 Round 3
- ❌ Issues → Implementer 修 → 重新 review（循环直到 ✅）

**核心检查 4（来自 PR #2340 教训）：**

- Implementer **是否跑了全套回归**？
  - 改 hooks/ → 跑完 tests/hooks/ 全套？
  - 改 lib/ → 跑完 tests/scripts/ + tests/engine/ 全套？
  - 只跑新 test 不算 — 要求 Implementer 补跑全套
  - 若 Implementer 报告里没明确提回归范围 → ❌ 拒绝

**核心检查 5: 决策一致性**
- 读 `.decisions-${BRANCH_NAME}.yaml`
- 对每条 matched decision，验证实现遵循
  - 决策说"用 PostgreSQL"→ 代码不能有 MongoDB 调用
  - 决策说"JWT + Refresh Token"→ 认证逻辑必须遵循
- 违背 → ❌ 拒绝，要求 Implementer 修改至与决策一致

**Model**: Sonnet（对比工作不需要深推理）

### 2.4 Round 3: Code Quality Reviewer Subagent

**前置**：Spec Review 必须先 ✅。顺序不能反。

输入 prompt（参考 `superpowers:subagent-driven-development/code-quality-reviewer-prompt.md`）：
- 实现完成的 task 描述
- git diff（BASE_SHA..HEAD_SHA）

**检查维度**：
- 代码质量（命名/结构/可维护性）
- 测试质量（测真实行为，不测 mock）— 见 `superpowers:test-driven-development/testing-anti-patterns.md`
- YAGNI（没过度设计）
- 文件职责清晰

**输出**：
- ✅ Approved → 标记 task 完成
- ❌ Critical/Important Issues → Implementer 修 → 重新 review

**Model**: Sonnet

### 2.5 失败自愈

**Implementer BLOCKED**:
```
第 1 次 → 补 context 重派（同模型）
第 2 次 → 升级到更强模型重派
第 3 次 → 使用 superpowers:systematic-debugging Phase 1 分析根因
          派 superpowers:dispatching-parallel-agents 独立诊断
```

**Spec Reviewer 连续 3 轮 ❌**:
```
不再让同一个 Implementer 修 → 派新 Implementer 从头实现这个 task
```

**连续 3 个 task BLOCKED**:
```
plan 本身有问题 → 回 Stage 1 重做 plan
```

### 2.6 所有 task 完成后

**使用 `superpowers:verification-before-completion` Gate**：

对 `.task-${BRANCH}.md` 每个 DoD 条目：
1. 运行 `Test:` 命令
2. 检查 exit code
3. 有证据才勾 [x]
4. 无证据 → 修 → 重跑

全部 [x] → `sed -i '' 's/step_2_code: pending/step_2_code: done/' ".dev-mode.${BRANCH_NAME}"`

完成后跳到 [完成后](#完成后)。

---

## 3. standard mode（默认流程）

### 3.1 探索代码

读取 Task Card 的「实现方案」部分，探索相关文件：

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
TASK_CARD=".task-${BRANCH_NAME}.md"
cat "$TASK_CARD"
```

**探索规则**：先读再改，理解现有代码，确认受影响的文件和函数。

---

### 3.2 写代码

直接修改代码文件，按 Task Card 实现方案执行。

**代码规范**：
- 不加多余注释、不加 console.log
- 不改 Scope 外的文件
- 单文件 > 500 行考虑拆分

---

### 3.3 逐条验证 DoD

> **仅非 Harness 模式执行此步骤。** Harness 模式由 Evaluator 独立验证。

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

### 3.4 标记完成 + 持久化

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
sed -i '' 's/step_2_code: pending/step_2_code: done/' "$DEV_MODE_FILE"
# .dev-mode 不提交到 git（.gitignore 已排除），只保留在本地
```

---

## Implementer 必须遵守的 Superpowers 纪律（v9.4.0 / Engine v14.16.0 补全）

下面三条规则是 Implementer subagent prompt 的**强制补丁**，对齐官方 Superpowers 5.0.7
`systematic-debugging` 和 `verification-before-completion` skill。派遣 Implementer 时必须
把这三块逐字注入 prompt。

### Condition-Based Waiting（防 test flakiness）

测试中**禁止**使用 `setTimeout / sleep / await new Promise(r => setTimeout(...))`。
必须用条件等待（waitFor 模式）：

```typescript
// ❌ BEFORE: 负载高时必 flaky
await new Promise(r => setTimeout(r, 50));
expect(getResult()).toBeDefined();

// ✅ AFTER: 条件满足就继续
await waitFor(() => getResult() !== undefined);
expect(getResult()).toBeDefined();
```

常用 pattern:

| 等什么 | waitFor 写法 |
|---|---|
| 事件 | `waitFor(() => events.find(e => e.type === 'DONE'))` |
| 状态机 | `waitFor(() => machine.state === 'ready')` |
| 计数 | `waitFor(() => items.length >= 5)` |
| 文件 | `waitFor(() => fs.existsSync(path))` |
| 复合 | `waitFor(() => obj.ready && obj.value > 10)` |

**唯一例外**：测的是 timing 行为本身（debounce / throttle 间隔）——此时必须在测试
注释里写明 "Testing timing behavior: <why>"，不许悄悄用。

### Pre-Completion Verification（完成前必证）

官方原话：**Evidence before claims, always.** Violating the letter of this rule
is violating the spirit of this rule.

**铁律**：报 DONE / 完成 / fixed / pass 前，**必须在本条消息里跑过验证命令**。
没跑过 = 撒谎不是效率。

报告格式强制三项：

```
DONE.
1. Test 跑过：
   $ vitest run packages/foo/__tests__/bar.test.ts
   → 9/9 passed (实际贴 stdout 尾部 3 行)
2. DoD 逐条验证：
   [BEHAVIOR] <条目> → <Test 命令> → <结果>
   [ARTIFACT] <条目> → <Test 命令> → <结果>
3. 相关目录全套回归：
   $ vitest run packages/foo/__tests__/
   → 42/42 passed
```

没证据 = BLOCKED，Spec Reviewer 直接打回。

红线（出现任一必须停）：
- 说 "should pass / probably works / seems fine"
- 未跑验证就说 "Done! / Great!"
- 信任 subagent 的 success 报告 without diff 检查
- "just this once" 的心态

### Root-Cause Tracing（bug fix 专属，向上追 4 步）

官方原则：Trace backward through the call chain until you find the original
trigger, then fix at the source.

Bug fix 时**禁止**只改症状所在那一行。按 4+1 步追：

**1. Observe the symptom（重现）**
写一个 fail 的 test 证明 bug 存在。没有 failing test 就开始修 = 瞎改。

**2. Find immediate cause（最近一层）**
报错在哪行代码？直接触发它的 API 是什么？

**3. Ask what called this（向上追调用链）**
至少追 2 层：
```
WorktreeManager.createSessionWorktree(projectDir, ...)
  ← called by Session.initializeWorkspace()
  ← called by Session.create()
  ← called by test setup
```

**4. Find original trigger（定位原点）**
数据从哪来？值为什么错？——是 API response 没校验？是配置默认值空？是 race？

**5. Fix at source + defense-in-depth（修原点 + 加多层防御）**
修最上游（e.g. fetch 层加 null 检查），并在中间层也加 assertion（e.g. Worktree
API 入口 assert 非空）。**修完加一条回归测试**覆盖原点路径。

示例：`TypeError: cannot read property "foo" of undefined`
- ❌ `obj?.foo` — 只修症状
- ✅ 追到 obj 来自 API response → fetch 层加 null 检查 → 消费层加 fallback → 测试覆盖"API 返回 null"路径

---

## 完成后

**Task Checkpoint**: `TaskUpdate({ taskId: "2", status: "completed" })`

**继续 → Stage 3 (Integrate)** — 读取 `skills/dev/steps/03-integrate.md` 并执行。
