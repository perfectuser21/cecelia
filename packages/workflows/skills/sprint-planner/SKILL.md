---
id: sprint-planner-skill
description: /sprint-planner — Harness v3.0 Layer 1：将用户需求展开为 PRD（含可执行验证命令）
version: 2.0.0
created: 2026-04-04
updated: 2026-04-07
changelog:
  - 2.0.0: v3.0 重构 — 删掉"合同协商"语言，每个 Feature 必须含可执行验证命令块，Phase 3 加 git push
  - 1.0.0: 初始版本
---

# /sprint-planner — Harness v3.0 Layer 1: 需求 → PRD

**角色**: Planner（规划者）
**职责**: 接受用户一句话需求，展开为完整 PRD，**每个 Feature 必须包含可执行验证命令**。不读代码，不拆 Sprint，不注册任务。

---

## 输入

从 task description / title 获取用户需求。

## 执行步骤

### Phase 1: 展开需求为 PRD

将用户需求展开为结构化 PRD，包含：

1. **产品目标**（1-3句话，说清楚要解决什么问题）
2. **功能清单**（具体的功能模块，每条一句话）
3. **验收标准**（每个功能的可测试通过条件 + **可执行验证命令**）
4. **AI 集成点**（如果适用：哪些地方用 AI 能力）
5. **不在范围内**（明确排除什么）

**原则**：
- 保持高层，不涉及实现细节
- 粒度适中：让 Generator 知道做什么，也让 Evaluator 能机械验证
- **验收标准必须配验证命令**：Evaluator 是"无脑执行器"——它只跑命令看 exit code，不读代码判断

### Phase 2: 写入 sprint-prd.md

```bash
SPRINT_DIR="${sprint_dir:-sprints}"
mkdir -p "$SPRINT_DIR"
```

写入 `${SPRINT_DIR}/sprint-prd.md`。**格式要求**：

```markdown
# Sprint PRD

## 产品目标
<1-3句话>

## 功能清单
- [ ] Feature 1: <描述>
- [ ] Feature 2: <描述>
...

## 验收标准

### Feature 1: <标题>
<描述条件>

## 验证命令
```bash
# 每条命令必须以 curl / node / npm / psql / bash 开头
# exit code 0 = PASS，非 0 = FAIL
# 命令必须验证真实行为，不能只检查文件是否存在
curl -s http://localhost:5221/api/brain/xxx | jq -e '.field == "expected_value"'
```

### Feature 2: <标题>
<描述条件>

## 验证命令
```bash
node -e "const r=require('./path'); if(!r.func()) process.exit(1)"
```

## 不在范围内
- <排除项1>
```

**验证命令写作规范**：
- 每个 Feature **必须** 有 `## 验证命令` 块，紧跟在 Feature 验收标准之后
- 命令必须以 `curl` / `node` / `npm` / `psql` / `bash` 开头（Evaluator 白名单）
- 命令验证**真实行为**：API 返回值、DB 记录、进程状态——不是文件是否存在
- exit code 0 = PASS，非 0 = FAIL（Evaluator 只看 exit code）
- 如果需要服务运行，在命令前注明 `# 需要 Brain 运行在 localhost:5221`

### Phase 3: git commit + push

PRD 写入完成后，必须将 PRD 推到 remote，否则 Generator 看不到：

```bash
cd "$(git rev-parse --show-toplevel)"
CURRENT_BRANCH=$(git branch --show-current)

git add "${SPRINT_DIR}/sprint-prd.md"
git commit -m "feat(planner): sprint PRD — $(basename ${SPRINT_DIR})"
git push origin "${CURRENT_BRANCH}"

echo "sprint-prd.md 已推送到 ${CURRENT_BRANCH}"
```

完成后，Brain 断链自动创建 sprint_generate 任务，Generator 开始写代码。

**不需要**：读代码、拆 Sprint、调用 Brain API 注册任务。

---

## 输出 verdict

```json
{"verdict": "DONE", "prd_path": "sprints/sprint-prd.md"}
```
