---
id: sprint-planner-skill
description: /sprint-planner — Harness v3.1 Layer 1：将用户需求展开为高层产品 spec（不含技术细节/验证命令）
version: 3.0.0
created: 2026-04-04
updated: 2026-04-07
changelog:
  - 3.0.0: v3.1 修正 — 只写高层产品 spec，不写验证命令（验证命令由 contract 阶段 Generator 定）
  - 2.0.0: 误增验证命令（已回滚）
  - 1.0.0: 初始版本
---

# /sprint-planner — Harness v3.1 Layer 1: 需求 → 产品 Spec

**角色**: Planner（产品规划者）
**职责**: 接受用户一句话需求，展开为完整产品 spec。**只写用户行为和产品目标，不写技术实现，不写验证命令，不拆 Sprint。**

---

## 输入

从 task description / title 获取用户需求。

## 执行步骤

### Phase 1: 展开为产品 Spec

将用户需求展开为结构化 spec，包含：

1. **产品目标**（1-3句话，说清楚要解决什么问题、目标用户是谁）
2. **功能清单**（具体的功能模块，每条一句话，描述用户能做什么）
3. **验收标准**（每个功能"完成"的定义——从用户视角描述，不是技术测试）
4. **AI 集成点**（如果适用：哪些地方用 AI 能力更好）
5. **不在范围内**（明确排除什么，防止 Generator 过度实现）

**原则**：
- 高层描述，不涉及实现细节（不写"用 React"，写"用户可以在界面上..."）
- **绝对不写验证命令**——技术验证命令由 Generator 在 contract 草案中提出，Evaluator 审查
- 验收标准从**用户行为**角度描述：用户能做什么、看到什么、得到什么
- 足够具体让 Generator 知道目标，足够高层让 Generator 有技术选择空间

### Phase 2: 写入 sprint-prd.md

```bash
SPRINT_DIR="${sprint_dir:-sprints}"
mkdir -p "$SPRINT_DIR"
```

写入 `${SPRINT_DIR}/sprint-prd.md`：

```markdown
# Sprint PRD

## 产品目标
<1-3句话：解决什么问题，目标用户是谁>

## 功能清单
- [ ] Feature 1: <用户能做什么>
- [ ] Feature 2: <用户能做什么>
...

## 验收标准（用户视角）

### Feature 1
- 用户可以 <操作>，看到/得到 <结果>
- 当 <特殊情况> 时，系统 <正确反应>

### Feature 2
- ...

## AI 集成点（如适用）
- <哪里用 AI 能力>

## 不在范围内
- <排除项1>
- <排除项2>
```

### Phase 3: git commit + push

```bash
cd "$(git rev-parse --show-toplevel)"
CURRENT_BRANCH=$(git branch --show-current)
git add "${SPRINT_DIR}/sprint-prd.md"
git commit -m "feat(planner): sprint PRD"
git push origin "${CURRENT_BRANCH}"
echo "✅ sprint-prd.md 已推送到 ${CURRENT_BRANCH}"
```

完成后，Brain 断链自动创建 sprint_contract_propose 任务（Generator 开始提合同草案）。

**不需要**：读代码、拆 Sprint、调用 Brain API 注册任务。

---

## 输出 verdict

**CRITICAL**: 必须在输出中包含 `branch` 字段，Brain 用它告诉 Proposer 去哪个分支读 sprint-prd.md。

```json
{"verdict": "DONE", "prd_path": "sprints/sprint-prd.md", "branch": "<git branch --show-current 的值>"}
```
