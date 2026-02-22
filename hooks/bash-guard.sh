#!/usr/bin/env bash
# Bash Guard Hook - 凭据泄露 + HK 部署防护
# 只拦两类高确定性风险，不做分支保护（交给 Write/Edit Hook + GitHub 远端）
#
# 性能模型：
#   - 99% 的命令：2 次字符串匹配 (~2ms) → 放行
#   - 命中 HK 部署时：才跑 git 检查 (~200ms)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/hook-utils.sh
source "$SCRIPT_DIR/../lib/hook-utils.sh"

# ─── JSON 输入 ───────────────────────────────────────────────
INPUT="$(cat)"

if ! echo "$INPUT" | jq empty >/dev/null 2>&1; then
    exit 0
fi

CMD="$(echo "$INPUT" | jq -r '.tool_input.command // ""')"

if [[ -z "$CMD" ]]; then
    exit 0
fi

# ─── 配置 ────────────────────────────────────────────────────
# HK 部署目标（公网 IP + Tailscale IP）
HK_TARGETS='(43\.154\.85\.217|100\.86\.118\.99)'

# 部署命令（只拦 rsync/scp，不拦 ssh）
DEPLOY_CMDS='(^|\s|&&|\||\;)(rsync|scp)(\s)'

# 允许部署的分支
DEPLOY_ALLOW_BRANCH='^(main|develop)$'

# ─── 规则 1: 凭据泄露检测（纯字符串，~1ms）─────────────────
if text_contains_token "$CMD"; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [BASH GUARD] 命令行包含真实凭据" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "禁止在命令行中包含 API Key/Token。" >&2
    echo "" >&2
    echo "正确做法：" >&2
    echo "  1. 凭据存储到 ~/.credentials/<service>.env" >&2
    echo "  2. 使用 source ~/.credentials/xxx.env 后引用变量" >&2
    echo "  3. 使用 /credentials skill 管理凭据" >&2
    echo "" >&2
    exit 2
fi

# ─── 规则 1b: 凭据文件暴露检测（~2ms）─────────────────────────
# 拦截从 ~/.credentials/ 复制/重定向凭据到其他位置
# 允许: source, ls, test, cat（无重定向）, grep（无重定向）
if echo "$CMD" | grep -qF ".credentials/"; then
    # 拦截：cp/mv 凭据文件
    if echo "$CMD" | grep -qE '(cp|mv)\s+(-\w+\s+)*\S*\.credentials/'; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [BASH GUARD] 检测到凭据文件暴露风险" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "禁止复制/移动 ~/.credentials/ 中的凭据文件。" >&2
        echo "" >&2
        echo "正确做法：" >&2
        echo "  1. source ~/.credentials/<service>.env 加载环境变量" >&2
        echo "  2. 代码中使用 process.env.XXX 引用" >&2
        echo "  3. 使用 /credentials skill 管理凭据" >&2
        echo "" >&2
        exit 2
    fi
    # 拦截：读取凭据文件 + 重定向到文件或 tee
    if echo "$CMD" | grep -qE '(cat|head|tail|grep|sed|awk)\s+.*\.credentials/\S+' && \
       echo "$CMD" | grep -qE '>>?\s*\S|[|]\s*tee\s'; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [BASH GUARD] 检测到凭据内容重定向" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "禁止将 ~/.credentials/ 内容重定向到文件。" >&2
        echo "" >&2
        echo "正确做法：" >&2
        echo "  1. source ~/.credentials/<service>.env 加载环境变量" >&2
        echo "  2. 代码中使用 process.env.XXX 引用" >&2
        echo "  3. 使用 /credentials skill 管理凭据" >&2
        echo "" >&2
        exit 2
    fi
fi

# ─── 规则 2: HK 部署防护（两步匹配，命中才跑 git）─────────
# 第一步：是否是 rsync/scp 命令？（~1ms）
if ! echo "$CMD" | grep -Eq "$DEPLOY_CMDS"; then
    exit 0
fi

# 第二步：目标是否是 HK？（~1ms）
if ! echo "$CMD" | grep -Eq "$HK_TARGETS"; then
    exit 0
fi

# ─── 命中 HK 部署，执行 git 三连检 ──────────────────────────
debug_log "HK deploy detected, running git checks..."

# 检查 1: 必须在 git 仓库
if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [BASH GUARD] 不在 git 仓库中" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "无法验证部署安全性，请在 git 仓库中执行部署。" >&2
    echo "" >&2
    exit 2
fi

# 检查 2: 工作区必须干净
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [BASH GUARD] 工作区不干净" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "部署到 HK 前必须先提交所有变更。" >&2
    echo "  git add -A && git commit" >&2
    echo "" >&2
    exit 2
fi

# 检查 3: 必须有 upstream 且已同步
if ! git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [BASH GUARD] 未设置 upstream" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "部署到 HK 前必须 push 到远端。" >&2
    echo "  git push -u origin $(get_current_branch)" >&2
    echo "" >&2
    exit 2
fi

HEAD_SHA="$(git rev-parse HEAD)"
UPSTREAM_SHA="$(git rev-parse @{u})"
if [[ "$HEAD_SHA" != "$UPSTREAM_SHA" ]]; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [BASH GUARD] 本地与远端不同步" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "请先 push 或 pull 同步后再部署。" >&2
    echo "" >&2
    exit 2
fi

# 检查 4: 分支必须在 allowlist
BRANCH="$(get_current_branch)"
if ! [[ "$BRANCH" =~ $DEPLOY_ALLOW_BRANCH ]]; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [BASH GUARD] 分支 '$BRANCH' 不允许部署" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "只允许从 main 或 develop 分支部署到 HK。" >&2
    echo "" >&2
    exit 2
fi

# 全部通过
exit 0
