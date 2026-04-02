---
id: dev-stage-01-spec
version: 4.0.0
created: 2026-03-20
updated: 2026-04-02
changelog:
  - 4.0.0: 精简 — 删除 Planner subagent、Sprint Contract Gate、LITE/FULL 路径。主 agent 直接写 Task Card。
---

# Stage 1: Spec — 读 PRD + 写 Task Card

> 主 agent 直接写 Task Card + DoD，不经 subagent。

**Task Checkpoint**: `TaskUpdate({ taskId: "1", status: "in_progress" })`

---

## 1.1 参数检测 + PRD 获取

### 有 --task-id 参数时

```bash
TASK_ID="<从 parse-dev-args.sh 获取>"
bash skills/dev/scripts/fetch-task-prd.sh "$TASK_ID"
# 生成 .prd-task-xxx.md + .dod-task-xxx.md
```

### 无参数时

用户手动提供 PRD，或从对话上下文获取需求。

---

## 1.2 探索代码 + 写 Task Card

### 1.2.1 搜索相关 Learning

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
ls docs/learnings/ 2>/dev/null | head -5
# 搜索与当前任务相关的历史经验
```

### 1.2.2 写 Task Card

创建 `.task-${BRANCH_NAME}.md`，包含：

```markdown
---
id: task-${BRANCH_NAME}
type: task-card
branch: ${BRANCH_NAME}
created: YYYY-MM-DD
---

# Task Card: <任务简述>

## 需求（What & Why）
**功能描述**: （从 PRD 提取）
**背景**: （为什么要做）
**不做什么**: （Scope 边界）

## 成功标准
> [ARTIFACT] 产出物 / [BEHAVIOR] 运行时行为

## 验收条件（DoD）

- [ ] [BEHAVIOR] <条目描述>
  Test: manual:node -e "<验证命令>"

- [ ] [ARTIFACT] <条目描述>
  Test: manual:node -e "<验证命令>"

## 实现方案（必填 — 探索后补充）
**要改的文件**: （具体路径）
**受影响函数/API**: （具体函数名）
**不改什么**: （Scope 边界）
```

**DoD 规则**：
- 至少 1 个 `[BEHAVIOR]` 条目
- Test 字段必须立即填写（不留 TODO）
- `manual:` 命令白名单：`node`/`npm`/`curl`/`bash`/`psql`

---

## 1.3 写入 .dev-mode + 持久化

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
cat > ".dev-mode.${BRANCH_NAME}" << EOF
dev
branch: ${BRANCH_NAME}
task_card: .task-${BRANCH_NAME}.md
started: $(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)
step_0_worktree: done
step_1_spec: done
step_2_code: pending
step_3_integrate: pending
step_4_ship: pending
EOF

# 立即 commit 防止上下文压缩丢失
git add ".dev-mode.${BRANCH_NAME}" ".task-${BRANCH_NAME}.md"
git commit -m "chore: [state] persist .dev-mode — Stage 1 Spec 完成"
```

---

## 完成后

**Task Checkpoint**: `TaskUpdate({ taskId: "1", status: "completed" })`

**继续 → Stage 2 (Code)**

读取 `skills/dev/steps/02-code.md` 并执行。
