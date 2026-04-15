---
id: dev-stage-01-spec
version: 6.3.0
created: 2026-03-20
updated: 2026-04-15
changelog:
  - 6.3.0: autonomous 分支改为由 Superpowers chain 驱动，所有 user 交互由 Research Subagent 代答
  - 6.2.0: autonomous 分支读 Step 0.7 产出的 .decisions-<branch>.yaml，作为技术决策硬约束
  - 6.1.0: autonomous 分支优先读 Step 0.5 enriched PRD
  - 6.0.0: autonomous_mode — 内嵌 superpowers:brainstorming + writing-plans 自主流程
  - 5.0.0: Superpowers 融入 — 零占位符规则 + Self-Review
  - 4.1.0: Harness v2.0 适配 — harness_mode 下跳过自写 Task Card/DoD，读 sprint-contract.md
  - 4.0.0: 精简 — 删除 Planner subagent、Sprint Contract Gate、LITE/FULL 路径。主 agent 直接写 Task Card。
---

# Stage 1: Spec — 读 PRD + 写 Task Card

> 主 agent 直接写 Task Card + DoD，不经 subagent。

**Task Checkpoint**: `TaskUpdate({ taskId: "1", status: "in_progress" })`

---

## 0. 模式判断

检测 task payload 中的模式标志：

```bash
TASK_ID="<从 parse-dev-args.sh 获取>"
TASK_JSON=$(curl -s "http://localhost:5221/api/brain/tasks/${TASK_ID}")
HARNESS_MODE=$(echo "$TASK_JSON" | jq -r '.payload.harness_mode // false')
AUTONOMOUS_MODE=$(echo "$TASK_JSON" | jq -r '.payload.autonomous_mode // false')
```

- `harness_mode = true` → 跳转 **0.1**
- `autonomous_mode = true` → 跳转 **0.2**
- 两者均 false → 继续 **1.1（标准模式）**

---

## 0.1 harness_mode = true 时

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
owner_session: ${CLAUDE_SESSION_ID:-unknown}
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

## 0.2 autonomous_mode = true 时（全自动：PRD → Plan，不问用户）

**v6.3.0 autonomous 分支变化**:
autonomous_mode=true 时, 本 step 不再由主 agent 直接写 Task Card。
改为: 主 agent 按 `autonomous-research-proxy.md` 规则驱动 Superpowers chain
(brainstorming -> writing-plans -> subagent-driven-development),
由 Superpowers 产出的 spec 作为 Task Card 输入。
所有 Superpowers 的 user 交互点由 Research Subagent 代答。

使用 `superpowers:brainstorming` + `superpowers:writing-plans` 的行为纪律，但跳过所有用户确认步骤。

### 0.2.0 优先读 enriched PRD（v6.1.0 新增）

```bash
# v6.1.0: 优先读 enriched PRD（由 Step 0.5 产出）
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
ENRICHED_PRD=".enriched-prd-${BRANCH_NAME}.md"
RAW_PRD=".raw-prd-${BRANCH_NAME}.md"

if [[ -f "$ENRICHED_PRD" ]]; then
    PRD_SOURCE="$ENRICHED_PRD"
    echo "使用 enriched PRD (Step 0.5 产出)"
elif [[ -f "$RAW_PRD" ]]; then
    PRD_SOURCE="$RAW_PRD"
    echo "使用 raw PRD (未经 enrich)"
fi
```

后续所有 PRD 读取使用 `${PRD_SOURCE}` 代替原 fetch 路径。

### 0.2.1 读历史决策约束（Step 0.7 产出）

```bash
DECISIONS_FILE=".decisions-${BRANCH_NAME}.yaml"
if [[ -f "$DECISIONS_FILE" ]]; then
    echo "读取历史决策约束..."
    cat "$DECISIONS_FILE"
fi
```

Task Card 的"实现方案"section 必须引用 matched decisions:
- 每个重要选择写明 "来自决策 #<id>: <decision>"
- DoD 加"决策一致性"BEHAVIOR 条目

### 0.2.2 探索 + 影响分析

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
```

执行以下探索（与标准模式 1.1-1.2.1 相同）：

1. 获取 PRD：`bash skills/dev/scripts/fetch-task-prd.sh "$TASK_ID"`
2. 搜索相关 Learning：`ls docs/learnings/ 2>/dev/null | head -10`
3. 阅读受影响的核心文件，理解当前实现
4. 识别改动边界：要改什么文件、不改什么

### 0.2.3 自主技术决策（brainstorming 骨架，跳过用户交互）

列出 2-3 个方案，用表格对比：

| 方案 | Good | Bad |
|------|------|-----|
| A: ... | ... | ... |
| B: ... | ... | ... |

自己选最直接的方案。**禁止**问用户"你想要 A 还是 B"。决策依据写入 plan 文件。

### 0.2.4 写 Implementation Plan（writing-plans 规则）

产出 `.plan-${BRANCH_NAME}.md`，符合：

- 每个 task：**精确到文件路径 + 代码 + 测试命令 + 预期输出**
- 零占位符：TBD/TODO/稍后/适当/相应/同上 **全禁**
- 每步 2-5 分钟粒度
- TDD 顺序：写测试 → 验证失败 → 写实现 → 验证通过 → commit

### 0.2.5 Self-Review 4 步

1. **Spec 覆盖度** — PRD 每个需求有对应 task？
2. **占位符扫描** — 有无 TBD/TODO/稍后/适当？
3. **命令可执行性** — 每个 Test 命令能在终端跑？
4. **Step 4: 跨 task 类型一致性扫描（Type consistency）** — 正则提取 plan 中所有函数签名 / 常量定义 / 导入名，自检 Task 间一致性。防 `clearLayers()` 定义 vs `clearFullLayers()` 调用这类隐性不匹配。发现问题立即修 plan，不重跑 Self-Review。

有问题 → 修 → 继续（不重复 review）

### 0.2.6 写 Task Card + 持久化

- `.task-${BRANCH_NAME}.md`（含 DoD，至少 1 个 `[BEHAVIOR]`）
- 在 DoD 中引用 `.plan-${BRANCH_NAME}.md`
- 写 `.dev-mode.${BRANCH_NAME}` 标记如下：

```bash
cat > ".dev-mode.${BRANCH_NAME}" << EOF
dev
branch: ${BRANCH_NAME}
owner_session: ${CLAUDE_SESSION_ID:-unknown}
autonomous_mode: true
task_id: ${TASK_ID}
task_card: .task-${BRANCH_NAME}.md
plan: .plan-${BRANCH_NAME}.md
started: $(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)
step_0_worktree: done
step_1_spec: done
step_2_code: pending
step_3_integrate: pending
step_4_ship: pending
EOF

git add ".task-${BRANCH_NAME}.md" ".plan-${BRANCH_NAME}.md"
git commit -m "chore: [state] Stage 1 Spec 完成 (autonomous)"
```

**直接进入 Stage 2 (Code)** — 读取 `skills/dev/steps/02-code.md` 并执行。

---

### autonomous_mode = false（默认，现有流程不变）

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
owner_session: ${CLAUDE_SESSION_ID:-unknown}
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
