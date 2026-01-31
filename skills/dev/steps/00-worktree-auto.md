---
id: dev-step-00-worktree-auto
version: 1.0.0
created: 2026-01-31
updated: 2026-01-31
changelog:
  - 1.0.0: 初始版本 - worktree 自动检测与创建
---

# Step 0: Worktree 自动检测（前置步骤）

> /dev 启动后第一件事：检测是否需要 worktree 隔离

**在 Step 1 (PRD) 之前执行**。确保后续所有步骤都在正确的工作目录中。

---

## 检测条件

只有同时满足以下条件时才需要创建 worktree：

1. **在主仓库**（不是 worktree）
2. **存在 .dev-mode 文件**
3. **.dev-mode 不是僵尸**（session 仍然活跃）

```bash
# 检测是否在 worktree 中
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)
IS_WORKTREE=false
if [[ "$GIT_DIR" == *"worktrees"* ]]; then
    IS_WORKTREE=true
fi

PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
DEV_MODE_FILE="$PROJECT_ROOT/.dev-mode"
```

---

## 决策逻辑

```
在 worktree 中？→ 跳过，继续 Step 1
无 .dev-mode？ → 跳过，继续 Step 1
有 .dev-mode？ → 僵尸检测
  → 僵尸 → 清理 .dev-mode，继续 Step 1（不需要 worktree）
  → 活跃 → 自动创建 worktree → cd → 安装依赖 → 继续 Step 1
```

---

## 僵尸 .dev-mode 检测

**判定条件**（满足任一即为僵尸）：

1. **.dev-mode 超过 2 小时**：`started` 字段距现在超过 7200 秒
2. **分支不存在**：.dev-mode 中的分支在本地不存在

```bash
# 读取 .dev-mode 信息
ACTIVE_BRANCH=$(grep "^branch:" "$DEV_MODE_FILE" 2>/dev/null | cut -d' ' -f2 || echo "")
STARTED=$(grep "^started:" "$DEV_MODE_FILE" 2>/dev/null | cut -d' ' -f2- || echo "")

# 条件 1: 超时检测（2 小时 = 7200 秒）
IS_ZOMBIE=false
if [[ -n "$STARTED" ]]; then
    STARTED_EPOCH=$(date -d "$STARTED" +%s 2>/dev/null || echo "0")
    NOW_EPOCH=$(date +%s)
    AGE_SECONDS=$(( NOW_EPOCH - STARTED_EPOCH ))
    if [[ "$AGE_SECONDS" -gt 7200 ]]; then
        IS_ZOMBIE=true
        echo "⚠️  .dev-mode 已超过 2 小时 (${AGE_SECONDS}s)，判定为僵尸"
    fi
fi

# 条件 2: 分支不存在
if [[ -n "$ACTIVE_BRANCH" ]] && ! git rev-parse --verify "$ACTIVE_BRANCH" &>/dev/null; then
    IS_ZOMBIE=true
    echo "⚠️  分支 $ACTIVE_BRANCH 不存在，判定为僵尸"
fi
```

### 僵尸处理

```bash
if [[ "$IS_ZOMBIE" == "true" ]]; then
    echo "🧹 清理僵尸 .dev-mode（分支: $ACTIVE_BRANCH）"
    rm -f "$DEV_MODE_FILE"
    # 不需要创建 worktree，继续正常流程
fi
```

---

## 自动创建 Worktree

**非僵尸 + 确实有活跃任务**时执行：

```bash
# 从用户需求或 PRD 文件名提取 task-name
# /dev .prd-xxx.md → task-name = xxx
# /dev "做登录功能" → task-name = 由 AI 生成的简短英文名
TASK_NAME="<从用户输入提取的简短英文任务名>"

echo "🔀 检测到活跃任务（分支: $ACTIVE_BRANCH），自动创建 worktree..."

# 创建 worktree（脚本最后一行输出路径到 stdout）
WORKTREE_PATH=$(bash skills/dev/scripts/worktree-manage.sh create "$TASK_NAME" 2>/dev/null | tail -1)

if [[ -z "$WORKTREE_PATH" || ! -d "$WORKTREE_PATH" ]]; then
    echo "❌ Worktree 创建失败"
    exit 1
fi

echo "✅ Worktree 创建成功: $WORKTREE_PATH"

# cd 到 worktree
cd "$WORKTREE_PATH"

# 安装依赖
if [[ -f "package.json" ]]; then
    echo "📦 安装依赖..."
    npm install --prefer-offline 2>/dev/null || npm install
fi
```

### AI 执行要点

1. **提取 task-name**：从用户输入或 PRD 文件名生成简短英文名（如 `login-feature`、`fix-ci-error`）
2. **执行 worktree-manage.sh**：捕获最后一行输出（worktree 路径）
3. **cd 到 worktree 路径**：后续所有操作都在 worktree 中
4. **安装依赖**：检测 package.json 存在时自动 npm install
5. **继续 Step 1**：PRD 文件直接在 worktree 中创建，不需要 copy

---

## 完成后

```bash
echo "✅ Step 0 完成 (Worktree 检测)"
```

继续 → Step 1 (PRD)
