# Learning: Stop Hook "未知" — cleanup.sh pipefail + stdout 污染 (cp-05042015)

**PR**: #2756
**分支**: cp-05042015-cleanup-gone-grep-fix
**合并时间**: 2026-05-04

## 背景

Stop Hook Ralph 模式（Stop Hook v21.0.0）在分支已合并 + Learning 文件存在的情况下，持续返回"未知"而不是"done"，导致 dev-active 状态文件无法清除，session 永远被阻塞。

## 做了什么

- `packages/engine/skills/dev/scripts/cleanup.sh` line 572：grep 管道加 `|| true`，防止 `set -euo pipefail` 在无 gone-branches 时杀死脚本
- `packages/engine/lib/devloop-check.sh` line 623：`cleanup.sh` 调用追加 `>/dev/null`，防止 cleanup.sh 的 UI 输出（echo 语句）污染 `verify_dev_complete` 的 result 变量

## 根本原因

**两层 bug 叠加导致"未知"**：

**Bug 1（cleanup.sh pipefail 崩溃）**：
```bash
# 原代码（有 bug）
GONE_BRANCHES=$(git branch -vv | grep ': gone]' | awk '{print $1}')
# grep 在无 gone branches 时 exit 1
# set -euo pipefail → 整个 cleanup.sh 在此行静默崩溃
# verify_dev_complete 捕获到 cleanup.sh 退出非 0 → blocked
```

**Bug 2（stdout 污染 jq 解析）**：
```bash
# 原代码（有 bug）
if ! (cd "$main_repo" && bash "$cleanup_script" "$branch") 2>/dev/null; then
# cleanup.sh 的 stdout（大量 echo 输出）未被重定向
# result=$(verify_dev_complete ...) 捕获了混合内容（JSON + UI 输出）
# jq 解析失败 → reason 回落到 "未知"
```

即使 Bug 1 修了，Bug 2 仍会让 reason 变"未知"。两个 bug 必须同时修复。

### 下次预防

- [ ] `verify_dev_complete` 调用任何子脚本时，必须同时重定向 stdout 和 stderr（`>/dev/null 2>/dev/null`），保证 `result` 变量只包含函数自己的 JSON 输出
- [ ] `set -euo pipefail` 脚本内所有 grep 管道都应加 `|| true`（或 `grep ... || :` ），除非明确需要在无匹配时失败
- [ ] Stop Hook 返回"未知"时应有专门的 debug 模式，直接打印 result 变量原始内容，方便诊断是 jq 解析失败还是函数未调用
