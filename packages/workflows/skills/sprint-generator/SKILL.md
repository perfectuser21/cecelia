---
id: sprint-generator-skill
description: |
  Sprint Generator — Harness v3.1 严格合同执行者。
  读取 GAN 对抗已批准的 sprint-contract.md，严格按合同实现，不越界。
  合同外的任何东西一个字不加。
version: 3.0.0
created: 2026-04-03
updated: 2026-04-07
changelog:
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

## Mode 1: sprint_generate（首次实现）

### Step 1: 读取已批准合同

```bash
CONTRACT_FILE="${SPRINT_DIR}/sprint-contract.md"
cat "$CONTRACT_FILE"
```

只读 `sprint-contract.md`，不读 `contract-draft.md`。

### Step 2: 逐 Feature 实现

- 读行为描述和硬阈值，写实现最小代码
- **不加合同未提及的任何东西**（安全阀、额外测试、顺手修复全不加）
- 发现合同外问题 → 只写进 PR description，不实现

### Step 3: Push + PR

```bash
git add <改动文件>
git commit -m "feat(sprint): <目标>"
git push origin HEAD
gh pr create --title "feat(sprint): <目标>" --body "..."
```

### Step 4: 输出

```json
{"verdict": "DONE", "pr_url": "https://github.com/.../pull/xxx"}
```

---

## Mode 2: sprint_fix（修复 Evaluator 反馈）

读 `eval-round-N.md` → 只修复 FAIL 的 Feature → Push

```json
{"verdict": "FIXED", "fixes": ["Feature X: <说明>"]}
```

---

## 禁止事项

1. **禁止自写 sprint-contract.md**
2. **禁止加合同外内容**
3. **禁止自判 PASS**
4. **禁止在 main 分支操作**
