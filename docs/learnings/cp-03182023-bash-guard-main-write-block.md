# Learning: bash-guard.sh 补漏 — Bash 重定向绕过 main 分支保护

**Branch**: cp-03182023-bash-guard-main-write-block
**Date**: 2026-03-18

## 根本原因

`hooks/bash-guard.sh` 规则 3 只检测特定代码文件扩展名（`.js`/`.sh` 等）的 Bash 重定向写入。但 `git show <ref>:packages/x > packages/x` 这类命令同样能绕过 `Write/Edit` 工具的 `branch-protect.sh` 保护，因为它走的是 Bash 工具的 shell 重定向，而不是 Write/Edit 工具。

真实案例：在 `main` 分支上执行 `git show origin/main:packages/brain/src/routes.js > packages/brain/src/routes.js` 成功写入，没有任何 hook 拦截。

## 修复

新增规则 3b：检测 `>>?[[:space:]]*['\"]?(packages|apps|scripts|hooks)/` 模式，在非 `cp-*/feature/*` 功能分支时 exit 2 拦截，输出 `[SKILL_REQUIRED: dev]`。

## 下次预防

- [ ] 每次改 bash-guard.sh 规则时，检查是否有新的绕过路径（Bash 重定向、Python 写文件、tee 等）
- [ ] branch-protect.sh（PreToolUse:Write|Edit）和 bash-guard.sh（PreToolUse:Bash）是两套保护，必须同步覆盖同等范围
- [ ] 修改 `hooks/` 下的文件时注意它是 symlink，实际文件在 `packages/engine/hooks/`，git add 时用 `packages/engine/hooks/xxx.sh` 路径
