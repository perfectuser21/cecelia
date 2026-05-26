# CI Auto-merge 扩展到所有 cp-* PR

**Goal:** 所有 cp-* 分支 PR CI 全绿后自动合并，不再限制 harness label。

**Architecture:** 修改 `.github/workflows/ci.yml` 的 auto-merge job，将 harness label 判断替换为 cp-* 分支名前缀判断。

**Tech Stack:** GitHub Actions bash

---

## 改动

**文件：** `.github/workflows/ci.yml`，auto-merge job step（~第 1346 行）

将：
```bash
LABELS=$(gh pr view "$PR_NUMBER" --json labels --jq '.labels[].name' 2>/dev/null || echo "")
if ! echo "$LABELS" | grep -q "harness"; then
  echo "ℹ️  No harness label, skipping auto-merge"
  exit 0
fi
```

改为：
```bash
HEAD_BRANCH="${{ github.head_ref }}"
if ! echo "$HEAD_BRANCH" | grep -qE '^cp-'; then
  echo "ℹ️  Not a cp-* branch, skipping auto-merge"
  exit 0
fi
```

## 测试策略

trivial — 下一个 cp-* PR CI 跑通即验证。

## 背景

stop hook 删除后，手动 /dev PR（无 harness label）失去自动合并能力。harness label 判断是历史遗留，所有 cp-* PR 应统一走 auto-merge。
