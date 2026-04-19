---
id: dev-stage-01-spec
version: 6.4.0
created: 2026-03-20
updated: 2026-04-18
changelog:
  - 6.4.0: R7 — 恢复 Superpowers brainstorming HARD-GATE 原话（本地化 `user approved` → `Research Subagent Tier 1 confirmed`），对齐官方 brainstorming/SKILL.md L12-14
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

## 0. 模式判断（harness / 主路径）

检测 task payload 中的 harness 标志：

```bash
TASK_ID="<从 parse-dev-args.sh 获取>"
TASK_JSON=$(curl -s "http://localhost:5221/api/brain/tasks/${TASK_ID}")
HARNESS_MODE=$(echo "$TASK_JSON" | jq -r '.payload.harness_mode // false')
```

- `harness_mode = true` → 跳转 **0.1**（Brain 派的 harness_generate 任务）
- 其他 → 继续 **0.2**（主路径，Subagent 三角色）

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

## 0.2 主路径（全自动：PRD → Plan，不问用户）

主 agent 按 `autonomous-research-proxy.md` 规则驱动 Superpowers chain
(brainstorming -> writing-plans -> subagent-driven-development),
由 Superpowers 产出的 spec 作为 Task Card 输入。
所有 Superpowers 的 user 交互点由 Research Subagent 代答。

使用 `superpowers:brainstorming` + `superpowers:writing-plans` 的行为纪律，但跳过所有用户确认步骤。

### 0.2.HARD-GATE — Superpowers brainstorming 强制门

> **来源**：Superpowers 5.0.7 brainstorming/SKILL.md L12-14（本地化到 autonomous）

<HARD-GATE>
Do NOT invoke any implementation skill, write any code, scaffold any project,
or take any implementation action until you have presented a design and the
Research Subagent has confirmed it via Tier 1 approval. This applies to
EVERY task regardless of perceived simplicity.
</HARD-GATE>

**本地化**：官方要求 `user approved`，autonomous 模式下由 Research Subagent 的
Tier 1 替代（见 `autonomous-research-proxy.md` Tier 1 表）。Tier 1 返回 ✓ 前
**禁止**进入 Stage 2 (02-code.md)。

**违规检测**：Stage 2 Implementer 派遣前，Controller 必须确认 `.task-<branch>.md`
的"实现方案"section 已有 Research Subagent 的 approved 标记。否则 abort。

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

### 0.2.5 Self-Review 5 步

> v14.15.0 补第 4 步"跨 task 类型一致性"对齐 Superpowers `writing-plans`。
> v14.17.0 补第 5 步"Critical Gap Abort"对齐 Superpowers `executing-plans`
> 的 "If concerns: Raise them with your human partner before starting"。
> 防 Task 3 定义 `clearLayers()` vs Task 7 调用 `clearFullLayers()` 这类
> 隐性不匹配在 plan 阶段逃脱，以及 PRD 矛盾 / 核心文件缺失等致命问题。

1. **Spec 覆盖度** — PRD 每个需求有对应 task？
2. **占位符扫描** — 有无 TBD/TODO/稍后/适当？
3. **命令可执行性** — 每个 Test 命令能在终端跑？
4. **Type consistency（跨 task 类型一致性扫描）** —
   逐个 task 提取所有**函数签名**（`function xxx(` / `const xxx = (` / `async xxx(`）、
   **常量/变量定义**、**import/export 名**，对比"被调用名"和"被定义名"：
   - Task N 定义了 `foo` 但 Task M 调用了 `bar` → 报不匹配
   - import `{ A, B }` 但下游用 `C` → 报缺失
   - 同名函数 Task N 签名 `(x, y)` 与 Task M 签名 `(x, y, z)` → 报参数数不一致
   发现问题 → 立刻修 plan 里的 task → 不触发整轮 Self-Review 重跑
   （只需局部修正后继续）。
5. **Step 5: Critical Gap Abort（引 `superpowers:executing-plans`）** —
   官方原则："If concerns: Raise them with your human partner before starting"。
   autonomous 下等价：主 agent 对 plan 有**否决权**，发现致命 gap 必须暂停。

   Self-Review 发现以下**任一** critical gap → **暂停 autonomous，不继续 Stage 2**：

   - **PRD 前后矛盾**：例如"不做 X"但 DoD 要求 X
   - **核心文件不存在**：PRD 引用的文件路径 `grep -l` fail
   - **DoD Test 命令语法错**：`bash -n <(cmd)` 或 `node -c cmd` fail
   - **决策冲突**：Plan 引用了 `.decisions-<branch>.yaml` 不存在的 decision #ID
   - **DoD 无 [BEHAVIOR]**：只有 [ARTIFACT] → CI L1 会失败

   触发动作：
   ```bash
   # 在 .dev-mode 中标记
   echo "autonomous_aborted: true" >> ".dev-mode.${BRANCH_NAME}"
   echo "abort_reason: <一句话>" >> ".dev-mode.${BRANCH_NAME}"
   # 创 Brain task 让人介入
   curl -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{
     \"title\": \"[autonomous_abort] ${TASK_ID} — Critical gap in plan\",
     \"task_type\": \"autonomous_abort_review\",
     \"priority\": \"P0\",
     \"description\": \"Plan self-review 发现 critical gap: ...\"
   }"
   # exit stage 1，不进 Stage 2
   exit 1
   ```

有问题 → 修 → 继续（不重复 review）。Step 5 触发 → 直接 abort（不修，让人决策）。

### 0.2.6 写 Task Card + 持久化

- `.task-${BRANCH_NAME}.md`（含 DoD，至少 1 个 `[BEHAVIOR]`）
- 在 DoD 中引用 `.plan-${BRANCH_NAME}.md`
- 写 `.dev-mode.${BRANCH_NAME}` 标记如下：

```bash
cat > ".dev-mode.${BRANCH_NAME}" << EOF
dev
branch: ${BRANCH_NAME}
owner_session: ${CLAUDE_SESSION_ID:-unknown}
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

## 完成后

**Task Checkpoint**: `TaskUpdate({ taskId: "1", status: "completed" })`

**继续 → Stage 2 (Code)**

读取 `skills/dev/steps/02-code.md` 并执行。
