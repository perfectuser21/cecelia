---
branch: cp-03242032-fix-auto-version-pr-merge
date: 2026-03-24
task: fix(ci): auto-version workflow — gh pr merge auto 失败修复
---

# Learning: Auto Version Workflow PR 创建失败根因

## 问题

Auto Version workflow 在 push to main 后触发，但 `gh pr create` 失败（exit 1），
导致整个 workflow 失败。

## 根本原因

1. **`--body` 包含多行 commit message 展开**：原来 `--body` 直接内联了 `${{ github.event.head_commit.message }}`，这个值包含多行中文文本和特殊字符，在 bash 的命令替换 `$(...)` 里展开时导致 `gh pr create` 参数解析出错。

2. **缺少幂等处理**：同一版本号可能因为多次 push 触发多次 workflow，第一次创建 PR 成功，第二次 `gh pr create` 因 PR 已存在而报错（exit 1），但没有 fallback。

3. **`gh pr merge --auto` 无保护**：auto-merge 请求在 CI 尚未开始时有时会失败，但 workflow 使用了 `set -e`，任何 exit 1 都会终止整个 workflow。

## 修复方案

```yaml
# 1. body 改为简单变量（不含多行 commit message）
PR_BODY="Automated version bump to ${NEW_VERSION}."

# 2. PR 创建幂等：失败时 fallback 到获取已有 PR
PR_URL=$(gh pr create ... 2>&1) \
  || PR_URL=$(gh pr view "$BRANCH_NAME" --json url -q '.url' 2>/dev/null \
     || echo "PR creation failed and no existing PR found")

# 3. auto-merge 加 || echo 保护
gh pr merge "$BRANCH_NAME" --squash --auto --delete-branch \
  || echo "Note: auto-merge request failed..."
```

## 下次预防

- [ ] workflow 中所有 `gh pr create/merge` 命令要考虑幂等性（同版本重复运行）
- [ ] `--body` 参数避免直接使用 commit message（可能含多行、特殊字符）
- [ ] 非关键步骤（如 auto-merge 请求）使用 `|| true` 或 `|| echo` 保护
- [ ] 调查 CI 失败时先看 "PR URL" 和 "Note:" 输出，判断是 PR 创建还是 merge 请求失败
