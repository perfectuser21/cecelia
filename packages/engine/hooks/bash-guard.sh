#!/usr/bin/env bash
# Bash Guard Hook - 凭据泄露 + 代码写入保护 + Skill 文件保护 + HK 部署防护
#                   + git push 前 local-precheck + git commit message 格式验证
#
# 性能模型：
#   - 99% 的命令：3 次字符串匹配 (~3ms) → 放行
#   - 命中代码写入时：才跑 git branch 检查 (~50ms)
#   - 命中 git push 时：跑 local-precheck.sh (~200ms，仅 Brain 改动时耗时)
#   - 命中 HK 部署时：才跑 git 三连检 (~200ms)

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
HK_TARGETS='(124\.156\.138\.116|100\.86\.118\.99)'

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

# ─── 规则 3: Bash 写代码文件检测（~3ms）──────────────────────
# 拦截 Bash 工具对代码文件的直接写入（与 branch-protect.sh 的 Write/Edit 保护对称）
# 放行条件：已在 cp-*/feature/* 分支（/dev 工作流中）或目标是 /tmp/ 路径
CODE_EXT_PATTERN='\.(js|jsx|ts|tsx|py|go|rs|java|rb|php|swift|kt|c|cpp|h|hpp|sh|bash|mjs|cjs)([[:space:]]|["\x27]|;|$|&&|\|\|)'
BASH_WRITES_CODE=false

# 模式 1: 重定向写入 (> file.ts 或 >> file.ts)
# 匹配形如: echo/printf/cat/anything > file.ext 或 >> file.ext
if echo "$CMD" | grep -Eq ">>?[[:space:]]*['\"]?[^'\"\n[:space:]>]*$CODE_EXT_PATTERN"; then
    # 排除 /tmp/ 路径
    if ! echo "$CMD" | grep -Eq ">>?[[:space:]]*/tmp/"; then
        BASH_WRITES_CODE=true
    fi
fi

# 模式 2: sed -i 原地修改代码文件
if [[ "$BASH_WRITES_CODE" == "false" ]]; then
    if echo "$CMD" | grep -qE '\bsed\b[^|]*-[iI]' && \
       echo "$CMD" | grep -Eq "$CODE_EXT_PATTERN"; then
        BASH_WRITES_CODE=true
    fi
fi

# 模式 3: | tee 写入代码文件
if [[ "$BASH_WRITES_CODE" == "false" ]]; then
    if echo "$CMD" | grep -Eq "\|[[:space:]]*tee[[:space:]]+['\"]?[^'\"\n[:space:]]*$CODE_EXT_PATTERN"; then
        BASH_WRITES_CODE=true
    fi
fi

if [[ "$BASH_WRITES_CODE" == "true" ]]; then
    # 只在非功能分支时拦截（cp-* 和 feature/* 已在 /dev 工作流中）
    CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
    # 不在 git 仓库或已在功能分支 → 放行
    if [[ -z "$CURRENT_BRANCH" ]] || [[ "$CURRENT_BRANCH" =~ ^(cp-|feature/) ]]; then
        : # 放行
    else
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [BASH GUARD] Bash 直接写代码文件被拦截" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "当前分支: $CURRENT_BRANCH" >&2
        echo "禁止在 '$CURRENT_BRANCH' 分支用 Bash 直接写代码文件。" >&2
        echo "代码变更必须在功能分支（cp-* / feature/*）中进行。" >&2
        echo "" >&2
        echo "[SKILL_REQUIRED: dev]" >&2
        echo "" >&2
        exit 2
    fi
fi

# ─── 规则 4: Skill 文件写入保护（~3ms）─────────────────────
# SKILL.md 通过 symlink 链条指向 git 仓库，修改 = 改 git tracked 代码
# 路径链: ~/.claude-account*/skills/ → ~/.claude/skills/ → packages/*/skills/
# 拦截所有包含 SKILL.md 路径的写入操作（python/redirect/tee/cp/mv）
SKILL_PATH_PATTERN='(\.claude(/|-account[0-9]*/)skills/|packages/(workflows|engine)/skills/)[^[:space:]]*SKILL\.md'
BASH_WRITES_SKILL=false

if echo "$CMD" | grep -Eq "$SKILL_PATH_PATTERN"; then
    # 放行只读操作: head/cat/grep/diff/ls/wc/file/stat 且无重定向
    if echo "$CMD" | grep -Eq '^[[:space:]]*(head|cat|grep|diff|ls|wc|file|stat|md5sum)\b' && \
       ! echo "$CMD" | grep -Eq '>>?\s|[|]\s*tee\s'; then
        : # 只读，放行
    else
        BASH_WRITES_SKILL=true
    fi
fi

if [[ "$BASH_WRITES_SKILL" == "true" ]]; then
    CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
    if [[ -z "$CURRENT_BRANCH" ]] || [[ "$CURRENT_BRANCH" =~ ^(cp-|feature/) ]]; then
        : # 功能分支，放行
    else
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [BASH GUARD] Skill 文件写入被拦截" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "当前分支: $CURRENT_BRANCH" >&2
        echo "SKILL.md 通过 symlink 指向 git 仓库，修改必须走 /dev。" >&2
        echo "" >&2
        echo "路径链:" >&2
        echo "  ~/.claude-account*/skills/ → ~/.claude/skills/ → packages/*/skills/" >&2
        echo "" >&2
        echo "[SKILL_REQUIRED: dev]" >&2
        echo "" >&2
        exit 2
    fi
fi

# ─── 规则 5: git push 前运行 local-precheck.sh ────────────────
# 拦截 git push（带或不带参数），在放行前跑 local-precheck.sh
# 放行条件：local-precheck.sh 退出码 0（或文件不存在）
if echo "$CMD" | grep -qE '(^|&&|\|\||;)[[:space:]]*git push(\s|$)'; then
    REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
    PRECHECK="$REPO_ROOT/scripts/local-precheck.sh"
    if [[ -f "$PRECHECK" ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [BASH GUARD] Gate 1: 运行 local-precheck..." >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        if ! bash "$PRECHECK"; then
            echo "" >&2
            echo "  ❌ local-precheck 失败，git push 被阻止" >&2
            echo "  请修复上述问题后再 push" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            exit 2
        fi
        echo "  ✅ local-precheck 通过，允许 push" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    fi
fi

# ─── 规则 6: git commit message 格式验证（conventional commits）──
# 拦截带 -m 参数的 git commit，验证消息格式
if echo "$CMD" | grep -qE '(^|&&|\|\||;)[[:space:]]*git commit\b'; then
    # 提取 -m "message" 或 -m 'message' 参数
    MSG=$(echo "$CMD" | sed -n 's/.*-m[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
    if [[ -z "$MSG" ]]; then
        MSG=$(echo "$CMD" | sed -n "s/.*-m[[:space:]]*'\\([^']*\\)'.*/\\1/p" | head -1)
    fi
    if [[ -n "$MSG" ]]; then
        # conventional commits 前缀（+ ops: 项目自定义）
        if ! echo "$MSG" | grep -qE '^(feat|fix|docs|chore|test|refactor|perf|ci|build|style|revert|ops)(\([^)]+\))?!?:[[:space:]]'; then
            echo "" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "  [BASH GUARD] Gate 5: commit message 格式不符" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "" >&2
            echo "  消息: $MSG" >&2
            echo "" >&2
            echo "  必须以 conventional commits 前缀开头：" >&2
            echo "    feat: / fix: / docs: / chore: / test:" >&2
            echo "    refactor: / perf: / ci: / build: / style: / revert: / ops:" >&2
            echo "  也支持 scope：feat(brain): / fix(ui):" >&2
            echo "  Breaking change：feat!: 或 feat(scope)!:" >&2
            echo "" >&2
            exit 2
        fi
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
