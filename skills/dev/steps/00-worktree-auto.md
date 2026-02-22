---
id: dev-step-00-worktree-auto
version: 2.1.0
created: 2026-01-31
updated: 2026-02-22
changelog:
  - 2.1.0: 修复主仓库 cp-*/feature-* 分支检测盲区（强制 worktree）
  - 2.0.0: 简化为强制创建 worktree（修复 Bug 1）
  - 1.0.0: 初始版本 - worktree 自动检测与创建
---

# Step 0: Worktree 强制创建（前置步骤）

> /dev 启动后第一件事：确保在独立 worktree 中工作

**在 Step 1 (PRD) 之前执行**。确保后续所有步骤都在正确的工作目录中。

---

## 核心理念（v2.0 简化）

**每次 /dev 都在独立 worktree 中工作**：
- ✅ 隔离开发环境，避免冲突
- ✅ 支持多任务并行
- ✅ 主仓库保持干净

**不再需要复杂检测**：
- ❌ 删除：多会话检测
- ❌ 删除：.dev-mode 僵尸检测
- ✅ 简化：不在 worktree → 就创建 worktree

---

## 决策逻辑（v2.1 修复盲区）

```
检测是否在 worktree 中？
  ├─ 是 → 跳过，继续 Step 1
  └─ 否（在主仓库）
       ├─ 在 develop/main → 正常创建 worktree
       └─ 在 cp-*/feature-* → ⚠️ 异常状态！仍然强制创建 worktree
           （主仓库的 cp-*/feature-* 分支是上次残留，不能复用）
```

### ⚠️ v2.1 修复：主仓库 cp-*/feature-* 盲区

**问题**：如果主仓库残留在 cp-*/feature-* 分支上，旧逻辑正确检测到"不在 worktree"并创建 worktree，
但 Step 3 的"恢复现有分支"逻辑会跳过分支创建，导致 AI 留在主仓库。

**修复**：Step 0 显式检测此情况并警告，确保 AI 理解必须 cd 到 worktree。
同时 Step 3 的"恢复现有分支"也加了 worktree 检查（双保险）。

---

## 执行步骤

### 1. 检测是否已在 worktree 中

```bash
# 检测是否在 worktree 中
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)
IS_WORKTREE=false

if [[ "$GIT_DIR" == *"worktrees"* ]]; then
    IS_WORKTREE=true
    echo "✅ 已在 worktree 中，继续 Step 1"
    # 跳过创建，直接继续 Step 1
    exit 0
fi

# v2.1: 检测主仓库是否残留在 cp-*/feature-* 分支上
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" =~ ^(cp-|feature/) ]]; then
    echo "⚠️  异常：主仓库残留在 $CURRENT_BRANCH 分支上"
    echo "   这是上次任务的残留分支，不能直接复用"
    echo "   必须创建独立 worktree 隔离开发"
    echo ""
fi

echo "📍 当前在主仓库（分支: $CURRENT_BRANCH），需要创建 worktree"
```

**CRITICAL**: 无论主仓库在什么分支上（develop、main、cp-*、feature-*），
只要不在 worktree 中，就必须创建 worktree。**绝对不要**因为"已经在 cp-* 分支上"就跳过 worktree 创建。

### 2. 提取 task-name

```bash
# 从用户输入或 PRD 文件名提取 task-name
# 示例：
#   /dev "修复登录 bug" → task-name = "fix-login-bug"
#   /dev .prd-add-api.md → task-name = "add-api"

# 如果有 PRD 文件参数
if [[ -f "$PRD_FILE" ]]; then
    TASK_NAME=$(basename "$PRD_FILE" .md | sed 's/^\.prd-//')
else
    # 从用户输入生成（由 AI 生成简短英文名）
    TASK_NAME="<AI-generated-task-name>"
fi

echo "📝 任务名: $TASK_NAME"
```

### 3. 创建 worktree

```bash
echo "🔀 创建独立 worktree..."

# 调用 worktree-manage.sh 创建
# 注意：worktree-manage.sh 会自动更新 develop（Bug 2 修复）
WORKTREE_PATH=$(bash ~/.claude/skills/dev/scripts/worktree-manage.sh create "$TASK_NAME" 2>/dev/null | tail -1)

if [[ -z "$WORKTREE_PATH" || ! -d "$WORKTREE_PATH" ]]; then
    echo "❌ Worktree 创建失败"
    exit 1
fi

echo "✅ Worktree 创建成功: $WORKTREE_PATH"
```

### 4. 切换到 worktree

```bash
# cd 到 worktree
cd "$WORKTREE_PATH" || exit 1

echo "📂 已切换到: $(pwd)"
```

### 5. 安装依赖

```bash
# 如果有 package.json，安装依赖
if [[ -f "package.json" ]]; then
    echo "📦 安装依赖..."
    npm install --prefer-offline 2>/dev/null || npm install
    echo "✅ 依赖安装完成"
fi
```

### 6. 完成

```bash
echo "✅ Step 0 完成 - Worktree 环境准备就绪"
echo ""
echo "📍 当前环境："
echo "   Worktree: $WORKTREE_PATH"
echo "   分支: $(git rev-parse --abbrev-ref HEAD)"
echo ""
```

---

## AI 执行要点

1. **提取 task-name**：
   - 从用户输入生成简短英文名（如 `login-feature`、`fix-ci-error`）
   - 或从 PRD 文件名提取（`.prd-xxx.md` → `xxx`）

2. **执行 worktree-manage.sh**：
   - 捕获最后一行输出（worktree 路径）
   - 检查路径是否有效

3. **cd 到 worktree 路径（CRITICAL）**：
   - 后续所有操作都在 worktree 中
   - **绝对不要回到主仓库**
   - **绝对不要用 `cd /path/to/主仓库` 然后 `git checkout`**
   - 如果需要操作其他分支，使用 `git -C <worktree-path>` 而不是 cd + checkout

4. **安装依赖**：
   - 检测 package.json 存在时自动 npm install
   - 使用 `--prefer-offline` 加速

5. **继续 Step 1**：
   - PRD 文件直接在 worktree 中创建/使用
   - 不需要从主仓库 copy

### ⚠️ 禁止行为

| 禁止 | 正确做法 |
|------|----------|
| `cd /主仓库 && git checkout cp-xxx` | 在 worktree 中操作 |
| 在主仓库的 cp-* 分支上直接开发 | 创建 worktree 后 cd 进去 |
| 因为"已经在 cp-* 分支"就跳过 worktree | 主仓库的 cp-* 是残留，必须创建 worktree |

---

## 向后兼容

**如果已经在 worktree 中**（用户手动创建）：
- ✅ 跳过创建，直接继续 Step 1
- ✅ 不会重复创建或报错

---

## 清理

**Worktree 在以下时机自动清理**：
- Step 11 (Cleanup) 删除 worktree
- 或 PR 合并后手动运行 `bash scripts/cleanup.sh`

---

## 完成后

继续 → Step 1 (PRD)
