---
id: learning-fix-engine-macos-compat
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
branch: cp-03141250-fix-engine-macos-compat
---

# Learning: Engine macOS Bash 3.2 多字节字符变量名解析 Bug（2026-03-14）

## Engine macOS Bash 3.2 兼容性 Bug（2026-03-14）

### 根本原因

macOS 自带 bash 版本为 **3.2.57**，对 UTF-8 多字节字符（全角逗号 `，`、全角括号 `）`）紧跟 `$VAR` 时，
会误将 UTF-8 首字节（如 `\xEF = 239`）纳入变量名边界，形成 `$VAR\xEF` 这样的未定义变量名，
配合 `set -euo pipefail` 触发 **unbound variable** 错误（exit 1），而非预期的 exit 0 或 exit 2。

具体触发点：
- `hooks/branch-protect.sh` 行 268：`"...今天 $TODAY，最早..."` → `TODAY\xEF` 未定义
- `runners/codex/runner.sh` 行 111：`"...（task_id: $task_id）..."` → `task_id\xEF` 未定义

### 下次预防

- [ ] bash 脚本中，变量后紧跟中文/全角字符时，**必须使用 `${VAR}` 花括号语法**（不能裸用 `$VAR`）
- [ ] 新增 shell 脚本时，在 macOS（bash 3.2）上本地跑一遍再提交，用 `bash -x` 发现运行时 unbound variable
- [ ] 测试 git init 时，使用 `git rev-parse --abbrev-ref HEAD` 或 `git branch --list main master` 动态检测默认分支名，不要硬编码 `master`

## macOS 测试兼容性修复总结（2026-03-14）

### 根本原因

CI 运行在 Linux（bash 5.x），本地运行在 macOS（bash 3.2 + git 2.39+）。
两者行为差异导致本地 `npm test` 有 37 个失败：
1. bash 3.2 多字节字符变量名 bug（见上）
2. `git init` 默认分支从 `master`（旧）变为 `main`（macOS git 2.x+）
3. `stat -c %a`（GNU stat）在 macOS 无效，应用 `test -x` 替代
4. `date -d '2 hours ago'`（GNU date）在 macOS 无效，应用 `date -v-2H`
5. `sed -i 's/.../' file`（GNU sed）在 macOS 需加空字符串 `sed -i '' 's/...'`

### 下次预防

- [ ] 写新 bash hook 或脚本时，在本地 macOS 用 `bash -x` 测试一遍
- [ ] `git init` 后不要假设初始分支名，使用 `git rev-parse --abbrev-ref HEAD` 或 `git branch --list main master` 检查
- [ ] 使用 `test -x` 替代 `stat -c %a` 检测可执行权限（跨平台）
- [ ] date 命令用 `date -v-2H +%Y%m%d%H%M 2>/dev/null || date -d '2 hours ago' +%Y%m%d%H%M` 兼容两平台
- [ ] sed 用 `sed -i '' '...' file 2>/dev/null || sed -i '...' file` 兼容两平台
