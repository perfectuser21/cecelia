# Step 3: 创建分支

> 创建功能分支，记录 base-branch

---

## 环境检查

```bash
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
REPO=$(basename "$(git rev-parse --show-toplevel)")

# 检测是否在 worktree 中
IS_WORKTREE=false
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)
if [[ "$GIT_DIR" == *"worktrees"* ]]; then
    IS_WORKTREE=true
    MAIN_WORKTREE=$(git worktree list 2>/dev/null | head -1 | awk '{print $1}')
fi

echo "📍 当前位置："
echo "   Repo: $REPO"
echo "   分支: $CURRENT_BRANCH"
if [[ "$IS_WORKTREE" == "true" ]]; then
    echo "   环境: Worktree"
    echo "   主工作区: $MAIN_WORKTREE"
fi
```

**分支处理逻辑**：

| 当前分支 | 动作 |
|----------|------|
| main | 不能在 main 开发，切到 develop |
| develop | → 创建 cp-* 分支 |
| feature/* | → 创建 cp-* 分支 |
| cp-* | ✅ 继续当前任务，跳到 Step 4 |

**Worktree 注意**：如果在 worktree 中，分支已由 worktree-manage.sh 创建。

---

## Worktree 冲突兜底（FALLBACK）

**正常情况下 Step 0 已处理 worktree 冲突。此处作为兜底**：

```bash
# 只在主仓库（非 worktree）时检查
if [[ "$IS_WORKTREE" == "false" ]]; then
    PROJECT_ROOT=$(git rev-parse --show-toplevel)
    DEV_MODE_FILE="$PROJECT_ROOT/.dev-mode"

    if [[ -f "$DEV_MODE_FILE" ]]; then
        ACTIVE_BRANCH=$(grep "^branch:" "$DEV_MODE_FILE" 2>/dev/null | cut -d' ' -f2 || echo "unknown")

        echo ""
        echo "⚠️  Step 0 未处理 worktree 冲突，兜底自动创建..."
        echo "   活跃分支: $ACTIVE_BRANCH"

        # 自动创建 worktree（与 Step 0 相同逻辑）
        TASK_NAME="<从用户输入提取的简短英文任务名>"
        WORKTREE_PATH=$(bash skills/dev/scripts/worktree-manage.sh create "$TASK_NAME" 2>/dev/null | tail -1)

        if [[ -n "$WORKTREE_PATH" && -d "$WORKTREE_PATH" ]]; then
            echo "✅ Worktree 创建成功: $WORKTREE_PATH"
            cd "$WORKTREE_PATH"

            # 安装依赖
            if [[ -f "package.json" ]]; then
                npm install --prefer-offline 2>/dev/null || npm install
            fi
        else
            echo "❌ Worktree 创建失败，无法继续"
            exit 1
        fi
    fi
fi
```

**逻辑**：
- 在 worktree 中 → 跳过检查（已隔离）
- 在主仓库且有 `.dev-mode` → **自动创建 worktree + cd**（兜底）
- 在主仓库且无 `.dev-mode` 但在 cp-*/feature-* 分支 → **也必须创建 worktree**（v2.1 新增）
- 在主仓库且无 `.dev-mode` 且在 develop/main → 继续创建分支

---

## 创建功能分支

```bash
# 检查是否从 Brain Task 创建（--task-id 参数）
# task_id 从 Step 1 传递（通过 PRD 文件名检测）
task_id=""
if ls .prd-task-*.md 2>/dev/null; then
    prd_file=$(ls .prd-task-*.md 2>/dev/null | head -1)
    task_id=$(echo "$prd_file" | sed 's/.prd-task-//' | sed 's/.md//')
fi

# 生成分支名
if [[ -n "$task_id" ]]; then
    # 从 Brain Task 创建：task-<id>
    BRANCH_NAME="task-$task_id"
else
    # 手动创建：{Feature ID}-{任务名}
    FEATURE_ID="<从 FEATURES.md 获取，如 W6>"
    TASK_NAME="<根据用户需求生成>"
    BRANCH_NAME="${FEATURE_ID}-${TASK_NAME}"
fi

# 记住当前分支作为 base
BASE_BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo "🌿 创建分支..."
echo "   名称: $BRANCH_NAME"
if [[ -n "$task_id" ]]; then
    echo "   来源: Brain Task ($task_id)"
fi
echo "   Base: $BASE_BRANCH"

# 创建分支
git checkout -b "$BRANCH_NAME"

# 保存 base 分支到 git config
git config branch.$BRANCH_NAME.base-branch "$BASE_BRANCH"

echo "✅ 分支已创建: $BRANCH_NAME"
echo "   Base: $BASE_BRANCH"
```

---

## 创建 .dev-mode 文件（CRITICAL）

**分支创建后，必须创建 .dev-mode 文件**，这是 Stop Hook 循环控制的信号：

```bash
# 生成 session_id（会话隔离，防止多会话串线）
# 优先使用 CLAUDE_SESSION_ID 环境变量，fallback 到随机 ID
if [[ -n "${CLAUDE_SESSION_ID:-}" ]]; then
    SESSION_ID="$CLAUDE_SESSION_ID"
else
    SESSION_ID=$(head -c 6 /dev/urandom | od -An -tx1 | tr -d ' \n')
fi

# 获取当前 TTY（有头模式下为 /dev/pts/N，无头模式下为 "not a tty"）
CURRENT_TTY=$(tty 2>/dev/null || echo "not a tty")

# 在项目根目录创建 .dev-mode（分支已创建，分支名正确）
# 包含 11 步 checklist 状态追踪
# 如果有 task_id，添加 task_id 字段

# 确定 PRD 文件名
if [[ -n "$task_id" ]]; then
    PRD_FILE=".prd-task-$task_id.md"
else
    PRD_FILE=".prd.md"
fi

# ===== 创建 .dev-lock（硬钥匙，必须成功）=====
echo "🔒 创建 .dev-lock..."

# 原子写入：先写临时文件，再 mv（防止竞态）
DEV_LOCK_TMP="$(mktemp .dev-lock.XXXXXX)"
{
  echo "dev_lock"
  echo "branch: $BRANCH_NAME"
  echo "session_id: ${SESSION_ID}"
  echo "created_at: $(date -Iseconds)"
} > "$DEV_LOCK_TMP"

# 原子移动（覆盖旧文件，即使 git 中存在也能成功）
mv -f "$DEV_LOCK_TMP" .dev-lock

if [[ -f .dev-lock ]]; then
    echo "✅ .dev-lock 创建成功（硬钥匙已设置）"
else
    echo "❌ .dev-lock 创建失败，无法继续" >&2
    exit 1
fi

# ===== 创建 sentinel file（三重保险）=====
# v12.19.0: 从 .git/hooks/ 移到根目录避免触发 Bash 工具的 .git 保护
echo "🛡️  创建 sentinel file..."
SENTINEL_TMP="$(mktemp .dev-sentinel.XXXXXX)"
{
  echo "dev_workflow_active"
  echo "branch: $BRANCH_NAME"
  echo "started: $(date -Iseconds)"
} > "$SENTINEL_TMP"
mv -f "$SENTINEL_TMP" .dev-sentinel

if [[ -f .dev-sentinel ]]; then
    echo "✅ Sentinel 创建成功（三重保险）"
else
    echo "⚠️  Sentinel 创建失败，但可以继续" >&2
fi

# ===== 创建 .dev-mode（软状态，允许失败）=====
echo "📝 创建 .dev-mode..."

# 原子写入（同样方式）
DEV_MODE_TMP="$(mktemp .dev-mode.XXXXXX)"
{
  echo "dev"
  echo "branch: $BRANCH_NAME"
  echo "session_id: ${SESSION_ID}"
  echo "tty: $CURRENT_TTY"
  echo "prd: $PRD_FILE"
  echo "started: $(date -Iseconds)"
  echo "retry_count: 0"
  echo "step_1_prd: done"
  echo "step_2_detect: done"
  echo "step_3_branch: done"
  echo "step_4_explore: pending"
  echo "step_5_dod: pending"
  echo "step_6_code: pending"
  echo "step_7_verify: pending"
  echo "step_8_pr: pending"
  echo "step_9_ci: pending"
  echo "step_10_learning: pending"
  echo "step_11_cleanup: pending"
  # 如果有 task_id，追加 task_id 字段
  if [[ -n "$task_id" ]]; then
    echo "task_id: $task_id"
  fi
} > "$DEV_MODE_TMP"

mv -f "$DEV_MODE_TMP" .dev-mode

if [[ -f .dev-mode ]]; then
    echo "✅ .dev-mode 创建成功（软状态已设置）"
else
    echo "⚠️  .dev-mode 创建失败，但 .dev-lock 已设置，可以继续" >&2
    echo "   Stop Hook 会检测到这个情况并阻止退出" >&2
fi

echo ""
echo "✅ 双钥匙状态机已初始化"
echo "   .dev-lock: 硬钥匙（不可绕过）"
echo "   .dev-mode: 软状态（11 步 checklist）"
echo "   sentinel: 三重保险（防止同时删除）"
echo "   session_id: $SESSION_ID"

# 注册会话到 /tmp/claude-engine-sessions/（多会话检测）
SESSION_DIR="/tmp/claude-engine-sessions"
mkdir -p "$SESSION_DIR"

cat > "$SESSION_DIR/session-$SESSION_ID.json" << INNER_EOF
{
  "session_id": "$SESSION_ID",
  "pid": $$,
  "tty": "$(tty 2>/dev/null | tr -d '\n' || echo 'not a tty')",
  "cwd": "$(pwd)",
  "branch": "$BRANCH_NAME",
  "started": "$(date -Iseconds)",
  "last_heartbeat": "$(date -Iseconds)"
}
INNER_EOF

echo "✅ 会话已注册（PID: $$，用于多会话检测）"
```

**文件格式**（含 11 步 checklist）：
```
# 手动创建（无 task_id）
dev
branch: H7-remove-ralph-loop
session_id: a1b2c3d4e5f6
tty: /dev/pts/3
prd: .prd.md
started: 2026-01-29T10:00:00+00:00
step_1_prd: done
step_2_detect: done
step_3_branch: done
step_4_explore: pending
step_5_dod: pending
step_6_code: pending
step_7_verify: pending
step_8_pr: pending
step_9_ci: pending
step_10_learning: pending
step_11_cleanup: pending

# 从 Brain Task 创建（有 task_id）
dev
branch: task-abc-123
session_id: a1b2c3d4e5f6
tty: /dev/pts/3
prd: .prd-task-abc-123.md
started: 2026-01-29T10:00:00+00:00
step_1_prd: done
step_2_detect: done
step_3_branch: done
step_4_explore: pending
step_5_dod: pending
step_6_code: pending
step_7_verify: pending
step_8_pr: pending
step_9_ci: pending
step_10_learning: pending
step_11_cleanup: pending
task_id: abc-123
```

**生命周期**：
- Step 3 分支创建后创建（此时分支名正确）
- Step 11 (Cleanup) 删除
- 或 PR 合并后由 Stop Hook 自动删除

---

## 创建 Task Checkpoint（CRITICAL）

**分支和 .dev-mode 创建后，必须创建所有 11 个 Task**，让用户看到进度：

```javascript
// 使用官方 Task 工具创建所有步骤
TaskCreate({ subject: "PRD 确认", description: "确认 PRD 文件存在且有效", activeForm: "确认 PRD" })
TaskCreate({ subject: "环境检测", description: "检测项目环境和配置", activeForm: "检测环境" })
TaskCreate({ subject: "分支创建", description: "创建或切换到功能分支", activeForm: "创建分支" })
TaskCreate({ subject: "探索代码", description: "读代码理解架构，输出实现方案", activeForm: "探索代码" })
TaskCreate({ subject: "DoD 定稿", description: "基于探索结果生成 DoD", activeForm: "定稿 DoD" })
TaskCreate({ subject: "写代码", description: "根据 PRD 实现功能 + 测试", activeForm: "写代码" })
TaskCreate({ subject: "本地验证", description: "跑 npm test 验证", activeForm: "本地验证" })
TaskCreate({ subject: "提交 PR", description: "版本号更新 + 创建 PR", activeForm: "提交 PR" })
TaskCreate({ subject: "CI 监控", description: "等待 CI 通过并修复失败", activeForm: "监控 CI" })
TaskCreate({ subject: "Learning 记录", description: "记录开发经验", activeForm: "记录经验" })
TaskCreate({ subject: "清理", description: "清理临时文件", activeForm: "清理中" })
```

**创建后更新 .dev-mode**：

```bash
# 添加 tasks_created 标记
echo "tasks_created: true" >> .dev-mode

echo "✅ Task Checkpoint 已创建（11 个步骤）"
```

**更新后的 .dev-mode 格式**：
```
# 手动创建
dev
branch: H7-task-checkpoint
session_id: a1b2c3d4e5f6
tty: /dev/pts/3
prd: .prd.md
started: 2026-01-29T10:00:00+00:00
tasks_created: true

# Brain Task 创建
dev
branch: task-abc-123
session_id: a1b2c3d4e5f6
tty: /dev/pts/3
prd: .prd-task-abc-123.md
started: 2026-01-29T10:00:00+00:00
tasks_created: true
task_id: abc-123
```

**Hook 检查**：
- branch-protect.sh 检查 `tasks_created: true`
- 缺少此字段时阻止写代码，提示运行 /dev

**然后标记前 3 个 Task 完成**：

```javascript
// Step 1-3 已完成
TaskUpdate({ taskId: "1", status: "completed" })  // PRD 确认
TaskUpdate({ taskId: "2", status: "completed" })  // 环境检测
TaskUpdate({ taskId: "3", status: "completed" })  // 分支创建
TaskUpdate({ taskId: "4", status: "in_progress" }) // 探索代码 - 下一步
```

---

## 分支命名规则

**格式**：`{Feature ID}-{任务名}`

| Feature | 任务描述 | 分支名 |
|---------|----------|--------|
| W6 (Worktree) | 脚本管理 | `W6-worktree-manage` |
| H1 (branch-protect) | 修复 bug | `H1-fix-checkout` |
| C1 (version-check) | 添加验证 | `C1-add-validation` |
| D1 (dev-workflow) | 清理提示词 | `D1-cleanup-prompts` |

**规则**：
- Feature ID 必须在 FEATURES.md 中已注册
- 新功能需先在 FEATURES.md 注册后再创建分支
- 任务名使用英文小写，多个单词用 `-` 连接
- 不需要 `cp-` 前缀（`cp-` 只用于 Checkpoint 编号）

---

## Task 命名规则

PRD 中的子任务使用 `T-{序号}-{任务名}` 格式：

```markdown
- [ ] T-001-worktree-manage | code | none
- [ ] T-002-cleanup-extend | code | T-001
- [ ] T-003-multi-feature-support | code | T-002
```

**概念说明**：
- **官方 Checkpoint**: Claude Code 自动撤销功能（Esc+Esc 打开 rewind）- 文件级别，自动保存
- **我们的 Task**: 开发单元（1 个 PR）- 功能级别，手动规划

---

## 恢复现有分支

如果当前已在功能分支（非 main/develop），**必须先检查是否在 worktree 中**：

```bash
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "develop" ]]; then
    # v2.1 修复：必须检查是否在 worktree 中
    GIT_DIR_CHECK=$(git rev-parse --git-dir 2>/dev/null)
    if [[ "$GIT_DIR_CHECK" != *"worktrees"* ]]; then
        # ⚠️ 在主仓库的 cp-*/feature-* 分支上 — 这是残留状态！
        echo "⚠️  异常：在主仓库的 $CURRENT_BRANCH 分支上（非 worktree）"
        echo "   这是上次任务的残留，不能直接复用"
        echo "   必须创建独立 worktree"
        echo ""

        # 强制创建 worktree（与 Step 0 相同逻辑）
        TASK_NAME="<从用户输入提取的简短英文任务名>"
        WORKTREE_PATH=$(bash skills/dev/scripts/worktree-manage.sh create "$TASK_NAME" 2>/dev/null | tail -1)

        if [[ -n "$WORKTREE_PATH" && -d "$WORKTREE_PATH" ]]; then
            echo "✅ Worktree 创建成功: $WORKTREE_PATH"
            cd "$WORKTREE_PATH"

            if [[ -f "package.json" ]]; then
                npm install --prefer-offline 2>/dev/null || npm install
            fi
        else
            echo "❌ Worktree 创建失败，无法继续"
            exit 1
        fi
    else
        # ✅ 在 worktree 中的 cp-*/feature-* 分支 — 正常恢复
        echo "✅ 已在功能分支: $CURRENT_BRANCH（worktree 中）"

        # 读取保存的状态
        BASE_BRANCH=$(git config branch.$CURRENT_BRANCH.base-branch)

        echo "   Base: $BASE_BRANCH"
        echo ""
        echo "🔄 继续开发"

        exit 0
    fi
fi
```

**CRITICAL**: 只有在 **worktree 中** 的功能分支才能直接恢复。
主仓库的功能分支是残留状态，必须创建 worktree 隔离。

---

## git config 状态

分支创建后，保存以下状态：

```bash
# 查看分支配置
git config --get branch.$BRANCH_NAME.base-branch
# 输出: develop
```

这些状态用于：
- **base-branch**: PR 时自动设置目标分支

---

## 完成后

```bash
echo "✅ Step 3 完成 (分支创建)"
echo ""
echo "📝 下一步: Step 4 (探索)"
```

---

## 注意事项

- **分支名格式**：`{Feature ID}-{任务名}`
- **Feature ID 必须已注册** - 在 FEATURES.md 中
- **base-branch 必须保存** - PR 时使用
- **不要用 `cp-` 前缀** - `cp-` 只用于 Task 编号（历史遗留，建议用 t- 但不强制）
