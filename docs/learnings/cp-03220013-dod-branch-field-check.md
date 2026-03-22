# Learning: branch-protect v27 — .dod.md 归属校验

**分支**: cp-03220013-47f15332-e9d5-47a5-932b-1b11ea
**日期**: 2026-03-22

## 任务概述

在 `branch-protect.sh` 中新增非阻断警告：若 worktree 根目录的 `.dod.md` frontmatter 有 `branch:` 字段且与当前分支不符，输出 `[WARN]` 提示。

## 根本原因

知识反刍条目"进入 worktree 后首先检查 .dod.md 是否属于本任务"——旧格式 `.dod.md`（无分支名后缀）残留时，无任何提示。

## 下次预防

- [ ] 新增 hook 检查时，确认插入点在 IS_WORKTREE=true + .dev-mode 通过之后（约第 529 行），确保只在活跃 worktree 中触发
- [ ] 非阻断警告统一模式：输出到 stderr，注释写明"仅警告，不阻断（不 exit）"，不加 exit 语句
- [ ] packages/ 子树开发必须在根目录同时放 `.prd-{branch}.md`（branch-protect v25 要求），否则 hook 会阻断
- [ ] DoD GATE 条目不要用泛化 `npm test` 命令，改为检查具体文件内容的 node -e 断言
