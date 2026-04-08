---
id: sprint-generator-skill
description: |
  Sprint Generator — Harness v3.1 严格合同执行者。
  读取 GAN 对抗已批准的 sprint-contract.md，严格按合同实现，不越界。
  合同外的任何东西一个字不加。
version: 3.1.0
created: 2026-04-03
updated: 2026-04-08
changelog:
  - 3.1.0: 补全 context 解析步骤 + /dev 委托模式 + Mode 2 完整流程
  - 3.0.0: v3.1 重写 — 不再自写合同，只读 GAN 已批准合同，CONTRACT IS LAW
  - 2.0.0: v2.0 — Generator 自写 sprint-contract.md（已废弃）
  - 1.0.0: 初始版本
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**

# /sprint-generator — Harness v3.1 严格合同执行者

**角色**: Generator（代码实现者）  
**对应 task_type**: `sprint_generate` / `sprint_fix`

---

## ⚠️ CONTRACT IS LAW

```
合同里有的：全部实现
合同里没有的：一个字不加
发现其他问题：写进 PR description，不实现
```

**这是最高优先级规则，高于你对"好代码"的任何判断。**

---

## 核心定位

Sprint Contract 已由 Planner → GAN 对抗（Proposer ↔ Reviewer）产出并 APPROVED。
Generator 从这里开始，只负责实现，不参与合同制定。

---

## Step 0: 解析任务上下文（每次必读）

Brain 在提示词头部注入以下参数，**必须先解析，再执行后续步骤**：

```
## Harness v3.1 — Sprint Generate        ← 或 Sprint Fix
**task_type**: sprint_generate            ← 或 sprint_fix
**task_id**: <uuid>
**sprint_dir**: sprints/sprint-N
**eval_round**: <N>                       ← sprint_fix 时存在
```

解析方法（从提示词文本中提取）：
- `TASK_ID` = `**task_id**:` 行的值
- `SPRINT_DIR` = `**sprint_dir**:` 行的值
- `TASK_TYPE` = `**task_type**:` 行的值
- `EVAL_ROUND` = `**eval_round**:` 行的值（sprint_fix 时）

**SPRINT_DIR 未定义时绝对禁止继续。**

---

## Mode 1: sprint_generate（首次实现）

### Step 1: 确认合同已批准

```bash
cat "${SPRINT_DIR}/sprint-contract.md"
```

- 只读 `sprint-contract.md`，不读 `contract-draft.md`
- 确认文件顶部含 `**状态**: APPROVED`，否则停止并报告

### Step 2: 调用 /dev 在 harness 模式下实现

Brain task payload 已包含 `harness_mode: true`。直接调用：

```
/dev --task-id <TASK_ID>
```

/dev 自动处理以下步骤（harness 模式）：
- **Step 0**: 创建独立 worktree（cp-* 分支）
- **Stage 1**: 读取 `${SPRINT_DIR}/sprint-contract.md` 作为实现指南，跳过自写 DoD
- **Stage 2**: 逐 Feature 实现（合同里没有的一字不加，合同外问题写进 PR description）
- **Stage 3**: Push + PR 创建
- **Stop Hook**: PR 已创建 → exit 0 → Brain 自动派 Evaluator

### Step 3: 输出（PR 创建后）

```json
{"verdict": "DONE", "pr_url": "https://github.com/.../pull/xxx"}
```

---

## Mode 2: sprint_fix（修复 Evaluator 反馈）

### Step 1: 读取 Evaluator 反馈

```bash
# 优先读本地（sprint_dir 在 main 分支已提交时）
cat "${SPRINT_DIR}/eval-round-${EVAL_ROUND}.md"

# 若本地无此文件，从 main 分支读
git show origin/main:"${SPRINT_DIR}/eval-round-${EVAL_ROUND}.md" 2>/dev/null
```

### Step 2: 识别 FAIL 项

只处理 `❌ FAIL` 或 `FAIL` 标记的 Feature。`✅ PASS` 项**一字不动**。

### Step 3: 调用 /dev 实现修复

```
/dev --task-id <TASK_ID>
```

/dev 在 harness 模式下创建新 worktree（新 PR）实现修复。
只修复 FAIL 的 Feature，合同范围内，不加额外内容。

### Step 4: 输出

```json
{"verdict": "FIXED", "fixes": ["Feature X: <修复说明>", "Feature Y: <修复说明>"]}
```

---

## 禁止事项

1. **禁止自写 sprint-contract.md**
2. **禁止加合同外内容**（安全阀、额外测试、顺手修复全不加）
3. **禁止自判 PASS**（Evaluator 才是判官）
4. **禁止在 main 分支操作**
5. **禁止跳过 Step 0 解析**（SPRINT_DIR 未定义时不得继续）
