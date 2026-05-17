# Cleanup Merged Artifacts Regex 修复 + 根目录清理

## 背景

`.github/workflows/cleanup-merged-artifacts.yml` 设计意图是：每次 PR 合到 main 后，自动删掉该分支遗留在根目录的 PRD/DoD/TASK_CARD 文件（这些在 PR review 期间 CI 需要，合并后是死重）。

但第 28 行正则写的是：

```bash
FILES=$(git ls-files | grep -E "^\.(prd|task)-" || true)
```

这个正则匹配的是**旧命名约定**：`.prd-*.md` / `.task-*.md`（带前导点、小写）。

而当前代码库的实际命名已经是：`DoD.cp-*.md` / `PRD.cp-*.md` / `TASK_CARD.cp-*.md`（大写、无前导点、带 `.cp-` 前缀）。

命名改了，workflow 的正则没跟着改。后果是：

- 仓库根目录积累了 **36 个** 死 md（24 DoD + 6 PRD + 9 TASK_CARD，30 天历史）
- 1 个 `DoD.md.bak`（明显备份垃圾）
- cleanup workflow 每次 push 到 main 都跑，每次都输出"✅ 无 prd/task 残留文件，跳过"，实际上一堆残留

## 目标

1. 把 workflow 正则改成兼容新旧两种命名
2. 把根目录已经积累的 36 个 cp- 垃圾 + 1 个 `DoD.md.bak` 一次性 `git rm`
3. 不动 `DoD.md` / `PRD.md`（不带 cp- 后缀，当前活跃 PR 使用）
4. 不动 `packages/engine/hooks/branch-protect.sh.bak`（engine 的遗留，不是 /dev 生成的，另议）

## 设计

### 改动 1：正则修复（单行改动）

`.github/workflows/cleanup-merged-artifacts.yml:28`

**Before**：
```bash
FILES=$(git ls-files | grep -E "^\.(prd|task)-" || true)
```

**After**：
```bash
FILES=$(git ls-files | grep -E '^(\.prd-|\.task-|DoD\.cp-|PRD\.cp-|TASK_CARD\.cp-)' || true)
```

覆盖：
- 旧命名：`.prd-*`、`.task-*`（向后兼容，防止历史分支合并时失配）
- 新命名：`DoD.cp-*`、`PRD.cp-*`、`TASK_CARD.cp-*`

**不匹配**：`DoD.md` / `PRD.md`（无 cp- 后缀），这些是活跃 PR 用的。

### 改动 2：一次性清理根目录历史垃圾

`git rm` 所有符合 `^(DoD|PRD|TASK_CARD)\.cp-.*\.md$` 的文件 + `DoD.md.bak`。

列表（在同一个 commit 里一次性删）：
- 24 × `DoD.cp-*.md`
- 6 × `PRD.cp-*.md`
- 9 × `TASK_CARD.cp-*.md`
- 1 × `DoD.md.bak`

## 不做的事（YAGNI）

- 不动 `.dev-seal.*` / `.dev-gate-*`（21 个隐藏 session 残留） — 这是 Engine stop hook 的责任，不是 cleanup workflow 的
- 不动 `docs/learnings/` 的 1117 个文件 — 归档策略是独立大议题
- 不动 `packages/engine/hooks/branch-protect.sh.bak` — 不是 /dev 产物
- 不改 workflow 运行时机（仍是 push to main 时跑）
- 不改提交消息格式（仍是 `chore(cleanup): 自动清理合并后的 prd/task 文件（N 个）[bot]`）

## 验证方式

**ARTIFACT 层**：
- `git ls-files | grep -cE "^(DoD|PRD|TASK_CARD)\.cp-"` 返回 `0`
- `git ls-files | grep -q "^DoD\.md\.bak$"` 失败（文件已删）
- `grep -q "DoD\\.cp-\\|PRD\\.cp-\\|TASK_CARD\\.cp-" .github/workflows/cleanup-merged-artifacts.yml` 成功

**BEHAVIOR 层**：
- `node -e` 读 workflow 文件，确认正则包含新旧两种模式
- 构造一个临时文件名 `DoD.cp-test.md`，跑正则检查能被匹配

## 风险

- 极低。纯文件删除 + 一行 regex 修改。worktree 隔离，不碰 main 活跃文件。

## 影响范围

- `.github/workflows/cleanup-merged-artifacts.yml`（1 行）
- 根目录 40 个文件（git rm）
