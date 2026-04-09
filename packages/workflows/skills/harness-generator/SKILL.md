---
id: harness-generator-skill
description: |
  Harness Generator — Harness v4.0 严格合同执行者。
  读取 GAN 对抗已批准的 sprint-contract.md，严格按合同实现，不越界。
  合同外的任何东西一个字不加。完成后创建 PR（供 CI + Evaluator 验证）。
version: 4.0.0
created: 2026-04-08
updated: 2026-04-08
changelog:
  - 4.0.0: Harness v4.0 Generator（严格合同执行者，输出 pr_url 供 harness_ci_watch 使用）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，不要 find/glob 查找任何 SKILL.md，直接按本文档流程操作。**

# /harness-generator — Harness v4.0 严格合同执行者

**角色**: Generator（代码实现者）  
**对应 task_type**: `harness_generate` / `harness_fix`

---

## ⚠️ CONTRACT IS LAW

```
合同里有的：全部实现
合同里没有的：一个字不加
发现其他问题：写进 PR description，不实现
```

---

## Mode 1: harness_generate（首次实现）

### Step 1: 读取已批准合同

```bash
CONTRACT_FILE="${SPRINT_DIR}/sprint-contract.md"
cat "$CONTRACT_FILE"
```

只读 `sprint-contract.md`，不读 `contract-draft.md`。

### Step 2: 创建 cp-* 分支

```bash
BRANCH="cp-$(date +%m%d%H%M)-harness-$(basename $SPRINT_DIR)"
git checkout -b "$BRANCH"
```

### Step 3: 逐 Feature 实现

- 读行为描述和硬阈值，写最小实现代码
- **不加合同未提及的任何东西**（安全阀、额外测试、顺手修复全不加）
- 发现合同外问题 → 只写进 PR description，不实现

### Step 4: 写 Learning 文件（push 前必须完成）

```bash
cat > docs/learnings/cp-$(date +%m%d%H%M)-harness-generator.md << 'EOF'
### 根本原因

[描述实现的功能和关键决策]

### 下次预防

- [ ] 检查点 1
- [ ] 检查点 2
EOF
```

### Step 5: Push + PR

```bash
git add <改动文件>
git commit -m "feat(harness): <目标>"
git push origin HEAD
PR_URL=$(gh pr create --title "feat(harness): <目标>" --body "..." | tail -1)
echo "PR created: $PR_URL"
```

### Step 6: 输出 verdict（⚠️ 关键 — Brain 通过此提取 pr_url）

> **CRITICAL**: 最后一条消息必须是**纯 JSON**，禁止任何其他文字（不加 markdown、不加说明）。
> Brain 的 execution.js 依赖此 JSON 提取 pr_url 并创建 harness_ci_watch。

**最后一条消息（复制此格式，替换 PR_URL）**：
```
{"verdict": "DONE", "pr_url": "https://github.com/perfectuser21/cecelia/pull/2074"}
```

实际执行时用变量：
```bash
echo "{\"verdict\": \"DONE\", \"pr_url\": \"$PR_URL\"}"
```

然后输出这一行作为最后消息（纯 JSON，不加其他内容）。

---

## Mode 2: harness_fix（修复 Evaluator 反馈 / CI 失败）

读 `eval-round-N.md`（Evaluator 反馈）或 `payload.ci_fail_context`（CI 失败）：
- 只修复 FAIL 的 Feature / CI 错误
- 推到原 PR 分支（不创建新 PR）

```bash
# 切到 PR 分支
gh pr checkout <pr_number>

# 修复
# ...

git add <改动文件>
git commit -m "fix(harness): <修复说明>"
git push origin HEAD
```

**最后一条消息（纯 JSON，禁止其他文字）**：
```bash
echo "{\"verdict\": \"FIXED\", \"fixes\": [\"Feature X: <说明>\"], \"pr_url\": \"$PR_URL\"}"
```

---

## 禁止事项

1. **禁止自写 sprint-contract.md**
2. **禁止加合同外内容**
3. **禁止自判 PASS**
4. **禁止在 main 分支操作**
