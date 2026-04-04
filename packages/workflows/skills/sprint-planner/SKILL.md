---
id: sprint-planner-skill
description: /sprint-planner — Harness v2.0 Layer 1：将用户需求展开为 PRD
version: 1.0.0
created: 2026-04-04
---

# /sprint-planner — Harness Layer 1: 需求 → PRD

**角色**: Planner（规划者）
**职责**: 接受用户一句话需求，展开为完整 PRD。**不读代码，不拆 Sprint，不注册任务。**

---

## 输入

从 task description / title 获取用户需求。

## 执行步骤

### Phase 1: 展开需求为 PRD

将用户需求展开为结构化 PRD，包含：

1. **产品目标**（1-3句话，说清楚要解决什么问题）
2. **功能清单**（具体的功能模块，每条一句话）
3. **验收标准**（每个功能的可测试通过条件）
4. **AI 集成点**（如果适用：哪些地方用 AI 能力）
5. **不在范围内**（明确排除什么）

**原则**：
- 保持高层，不涉及实现细节（不写"用 React"，写"用户可以在界面上..."）
- 粒度适中：不能太笼统，要让 Generator 知道做什么；不能太细，避免级联错误
- 每条验收标准必须可测试（有明确的输入→输出）

### Phase 2: 写入 sprint-prd.md

```bash
SPRINT_DIR="${sprint_dir:-sprints}"
mkdir -p "$SPRINT_DIR"
```

写入 `${SPRINT_DIR}/sprint-prd.md`：

```markdown
# Sprint PRD

## 产品目标
<1-3句话>

## 功能清单
- [ ] Feature 1: <描述>
- [ ] Feature 2: <描述>
...

## 验收标准
### Feature 1
- 用户可以 <操作>，系统返回 <结果>
- 当 <边界情况> 时，系统 <正确处理>

### Feature 2
...

## 不在范围内
- <排除项1>
- <排除项2>
```

### Phase 3: 完成

PRD 写入完成后，直接返回。Brain 断链自动创建第 1 个 Sprint 的合同协商任务。

**不需要**：读代码、拆 Sprint、调用 Brain API 注册任务。

---

## 输出 verdict

```json
{"verdict": "DONE", "prd_path": "sprints/sprint-prd.md"}
```
