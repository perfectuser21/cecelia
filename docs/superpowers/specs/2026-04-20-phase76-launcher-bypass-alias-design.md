# Phase 7.6 设计：claude-launch.sh 避开 shell function/alias 递归

**日期**：2026-04-20
**分支**：cp-0420175955-cp-04201759-phase76-launcher-bypass-alias
**Engine 版本**：v18.3.3 → v18.3.4（patch）

## 背景

Phase 7.1（PR #2460）建了 `scripts/claude-launch.sh` 强制 `--session-id`，用户加 `alias claude='bash /path/to/claude-launch.sh'` 到 `~/.zshrc` 重启 claude 后报 **permission denied**。

## 根因

Claude Code 的 shell-snapshots（`~/.claude-accountX/shell-snapshots/*.sh`）给 bash 子进程也注入了 `claude` shell function。launcher 里 `exec claude ...` 被解析成 shell function → 递归调回 launcher。

## 方案

launcher 用绝对路径/命令查找解析真 binary：

```bash
_CLAUDE_BIN="${CLAUDE_CODE_EXECPATH:-}"
[[ -z "$_CLAUDE_BIN" || ! -x "$_CLAUDE_BIN" ]] && _CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"
[[ -z "$_CLAUDE_BIN" || ! -x "$_CLAUDE_BIN" ]] && { echo "❌ 找不到真 claude" >&2; exit 127; }
exec "$_CLAUDE_BIN" --session-id "$SID" "$@"
```

`command -v` 跳过 shell function / alias，直接查 PATH，返回真 binary 绝对路径。

## DoD

- [x] [ARTIFACT] `scripts/claude-launch.sh` 用 `${CLAUDE_CODE_EXECPATH:-}` 或 `command -v claude` 解析真 binary
  Test: `manual:node -e "const c=require('fs').readFileSync('scripts/claude-launch.sh','utf8');if(!c.includes('CLAUDE_CODE_EXECPATH')||!c.includes('command -v claude'))process.exit(1)"`
- [x] [BEHAVIOR] launcher 跑 `--version` 能成功输出真 claude 版本号（不递归）
  Test: `manual:bash -c "bash scripts/claude-launch.sh --version 2>&1 | grep -qE '[0-9]+\.[0-9]+\.[0-9]+'"`
- [x] [ARTIFACT] Engine 7 处版本同步到 18.3.4
  Test: `manual:node -e "for (const f of ['packages/engine/VERSION','packages/engine/.hook-core-version','packages/engine/hooks/VERSION']) if (!require('fs').readFileSync(f,'utf8').includes('18.3.4')) process.exit(1)"`
