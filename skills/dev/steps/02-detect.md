# Step 2: 确认项目环境

> 快速确认项目类型，准备进入开发

---

## 检测方式

直接从项目文件判断，不需要额外扫描：

| 文件 | 项目类型 |
|------|----------|
| package.json | Node.js |
| pyproject.toml / requirements.txt | Python |
| go.mod | Go |
| Cargo.toml | Rust |

---

## 确认内容

```bash
echo "📋 项目环境："

# 项目名称
PROJECT_NAME=$(basename "$(pwd)")
echo "  名称: $PROJECT_NAME"

# 项目类型
if [[ -f "package.json" ]]; then
    echo "  类型: Node.js"
    VERSION=$(jq -r '.version // "未定义"' package.json)
    echo "  版本: $VERSION"
elif [[ -f "pyproject.toml" ]]; then
    echo "  类型: Python"
elif [[ -f "go.mod" ]]; then
    echo "  类型: Go"
elif [[ -f "Cargo.toml" ]]; then
    echo "  类型: Rust"
else
    echo "  类型: 未知"
fi

# 测试命令
if [[ -f "package.json" ]]; then
    if grep -q '"qa"' package.json 2>/dev/null; then
        echo "  测试: npm run qa"
    elif grep -q '"test"' package.json 2>/dev/null; then
        echo "  测试: npm test"
    fi
fi
```

---

## Worktree 自动检测

**如果在主仓库且已有 .dev-mode，建议使用 worktree 并行开发**：

```bash
# 检查是否在主仓库（非 worktree）
IS_MAIN_REPO=$(git rev-parse --is-inside-work-tree 2>/dev/null && \
               [[ ! -f "$(git rev-parse --git-dir)/worktrees" ]] && echo "true" || echo "false")

# 检查是否有活跃的 .dev-mode
if [[ -f ".dev-mode" ]] && [[ "$IS_MAIN_REPO" == "true" ]]; then
    ACTIVE_BRANCH=$(grep "^branch:" .dev-mode | cut -d' ' -f2)
    echo ""
    echo "⚠️  检测到主仓库有活跃 /dev 任务"
    echo "   活跃分支: $ACTIVE_BRANCH"
    echo ""
    echo "建议使用 worktree 并行开发："
    echo "  bash skills/dev/scripts/worktree-manage.sh create <feature-name>"
    echo ""
fi
```

**Worktree 使用场景**：
- 主仓库有未完成的 /dev 任务
- 需要同时开发多个功能
- 想保留当前工作上下文

**注意**：Step 3 会强制检查，如果有活跃任务必须用 worktree。

---

## 完成后

```bash
echo "✅ Step 2 完成 (项目环境确认)"
```

继续 → Step 3 创建分支
