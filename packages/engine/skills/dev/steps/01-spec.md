---
id: dev-stage-01-spec
version: 5.0.0
created: 2026-03-20
updated: 2026-04-13
changelog:
  - 5.0.0: Superpowers 融入 — 零占位符规则 + DoD 精度标准 + Self-Review 3 步（来自 superpowers:writing-plans）
  - 4.1.0: Harness v2.0 适配 — harness_mode 下跳过自写 Task Card/DoD，读 sprint-contract.md
  - 4.0.0: 精简 — 删除 Planner subagent、Sprint Contract Gate、LITE/FULL 路径。主 agent 直接写 Task Card。
---

# Stage 1: Spec — 读 PRD + 写 Task Card

> 主 agent 直接写 Task Card + DoD，不经 subagent。

**Task Checkpoint**: `TaskUpdate({ taskId: "1", status: "in_progress" })`

---

## 0. Harness 模式判断（harness_mode）

检测 task payload 是否包含 `harness_mode: true`：

```bash
TASK_ID="<从 parse-dev-args.sh 获取>"
# 查询 Brain 获取 task payload
TASK_JSON=$(curl -s "http://localhost:5221/api/brain/tasks/${TASK_ID}")
HARNESS_MODE=$(echo "$TASK_JSON" | jq -r '.payload.harness_mode // false')
```

### harness_mode = true 时

**跳过自写 Spec/Task Card/DoD。** Sprint Contract 已由 Generator 写好。

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
SPRINT_DIR=$(echo "$TASK_JSON" | jq -r '.payload.sprint_dir // "sprints/sprint-1"')

# 读取现有的 sprint-contract.md 作为实现指南
cat "${SPRINT_DIR}/sprint-contract.md"

# 写 .dev-mode（标记 harness_mode）
cat > ".dev-mode.${BRANCH_NAME}" << EOF
dev
branch: ${BRANCH_NAME}
harness_mode: true
sprint_dir: ${SPRINT_DIR}
task_id: ${TASK_ID}
started: $(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)
step_0_worktree: done
step_1_spec: done
step_2_code: pending
step_3_integrate: pending
step_4_ship: pending
EOF

# .dev-mode 不提交到 git（.gitignore 已排除），只保留在本地
# 只提交 task card 等代码文件
git commit --allow-empty -m "chore: [state] Stage 1 跳过 (harness)"
```

**直接进入 Stage 2 (Code)** — 读取 `skills/dev/steps/02-code.md` 并执行。

---

### harness_mode = false（默认，现有流程不变）

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

### 零占位符规则（来自 superpowers:writing-plans）

以下写法 **禁止出现** 在 DoD 中，出现即停下重写：

| 禁止 | 理由 |
|------|------|
| "TBD"、"TODO"、"稍后补充"、"待定" | 空白承诺，CI 无法执行 |
| "验证 API 返回正确数据" | 什么数据？什么格式？什么状态码？ |
| "确保功能正常" | 什么功能？怎么确认正常？ |
| "适当处理错误" | 什么错误？处理成什么？ |
| "类似上面" / "同上" | 必须写完整，执行者可能乱序看 |

每个 DoD 条目必须包含：
1. **精确的验证命令**（可直接复制到终端执行）
2. **预期输出或 exit code**（agent 对比用）

| 差的 DoD | 好的 DoD |
|---------|---------|
| 验证 API 正常工作 | `curl -s localhost:5221/api/brain/health \| jq -r '.status'` 预期输出 `ok` |
| 确保测试通过 | `cd packages/brain && npx vitest run src/tick.test.ts` 预期 exit 0 |
| 检查文件存在 | `manual:node -e "require('fs').accessSync('src/new-module.js')"` |

---

### 1.2.3 Task Card Self-Review（写完后强制自查）

Task Card 写完后，执行以下 3 步自查，**有任何一项不通过就修改后重查**：

**① Spec 覆盖度**：回读 PRD/需求描述的每个要求，确认每个都有对应的 DoD 条目。列出缺口。

**② 占位符扫描**：在 Task Card 中搜索以下关键词，有则修复：
`TBD | TODO | 稍后 | 适当 | 相应 | 类似上面 | 待定 | 后续 | 同上`

**③ 命令可执行性**：对每个 `Test:` 命令，检查：
- 这个命令能直接在终端跑吗？
- 需要哪些前置条件（服务启动、数据库、文件存在）？
- 在 CI 环境（无 Brain、无浏览器）能跑吗？如果不能，改用 `manual:node -e` 格式

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

# .dev-mode 不提交到 git（.gitignore 已排除），只保留在本地
# 只提交 task card（代码文件）
git add ".task-${BRANCH_NAME}.md"
git commit -m "chore: [state] Stage 1 Spec 完成"
```

---

## 完成后

**Task Checkpoint**: `TaskUpdate({ taskId: "1", status: "completed" })`

**继续 → Stage 2 (Code)**

读取 `skills/dev/steps/02-code.md` 并执行。
