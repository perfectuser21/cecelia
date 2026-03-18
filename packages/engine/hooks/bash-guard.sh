#!/usr/bin/env bash
# Bash Guard Hook - 凭据泄露 + 代码写入保护 + Skill 文件保护 + HK 部署防护
#
# 性能模型：
#   - 99% 的命令：3 次字符串匹配 (~3ms) → 放行
#   - 命中代码写入时：才跑 git branch 检查 (~50ms)
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

# ─── 规则 2a: git push 前跑 local-precheck.sh（~200ms，仅 Brain 改动时实际执行）──
# 拦截 `git push` 命令（不含 --delete/--tags 等纯元操作）
# 失败时阻止 push，防止破坏 Brain 与 DEFINITION.md 的一致性
if echo "$CMD" | grep -qE '^\s*git\s+push(\s|$)'; then
    REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
    PRECHECK_SCRIPT="$REPO_ROOT/scripts/local-precheck.sh"

    if [[ -f "$PRECHECK_SCRIPT" ]]; then
        if ! bash "$PRECHECK_SCRIPT" >&2; then
            echo "" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "  [BASH GUARD] git push 被阻止：local-precheck 失败" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "" >&2
            echo "请修复上述 precheck 错误后重新 push。" >&2
            echo "（Brain 未改动时 precheck 自动跳过，不影响速度）" >&2
            echo "" >&2
            exit 2
        fi
    fi
    # 脚本不存在时放行（非 cecelia 仓库或路径不同）
fi

# ─── 规则 2b: git commit message 格式验证（~2ms）──────────────
# 拦截不符合 Conventional Commits 规范的提交消息
# 只检查带 -m/--message 的内联消息，interactive 模式不拦截
VALID_COMMIT_PREFIXES='^(feat|fix|docs|chore|test|refactor|build|ci|style|perf|revert)(\!|\([^)]+\))?:'
if echo "$CMD" | grep -qE '^\s*git\s+commit\b'; then
    # 提取 -m "..." 或 -m '...' 中的消息
    COMMIT_MSG=$(echo "$CMD" | sed -nE 's/.*[[:space:]]-m[[:space:]]+"([^"]+)".*/\1/p' | head -1 || true)
    if [[ -z "$COMMIT_MSG" ]]; then
        COMMIT_MSG=$(echo "$CMD" | sed -nE "s/.*[[:space:]]-m[[:space:]]+'([^']+)'.*/\1/p" | head -1 || true)
    fi
    if [[ -z "$COMMIT_MSG" ]]; then
        COMMIT_MSG=$(echo "$CMD" | sed -nE 's/.*--message[[:space:]]+"([^"]+)".*/\1/p' | head -1 || true)
    fi

    if [[ -n "$COMMIT_MSG" ]]; then
        if ! echo "$COMMIT_MSG" | grep -qE "$VALID_COMMIT_PREFIXES"; then
            echo "" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "  [BASH GUARD] commit message 格式不符合规范" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "" >&2
            echo "  消息: $COMMIT_MSG" >&2
            echo "" >&2
            echo "  要求 Conventional Commits 格式（以下之一）：" >&2
            echo "    feat: / fix: / docs: / chore: / test: / refactor:" >&2
            echo "    build: / ci: / style: / perf: / revert:" >&2
            echo "    feat!:（破坏性变更）/ feat(scope):（带 scope）" >&2
            echo "" >&2
            echo "  示例: git commit -m \"feat: 添加用户登录功能\"" >&2
            echo "" >&2
            exit 2
        fi
    fi
    # 无 -m 参数（interactive 模式）→ 放行
fi

# ─── 规则 2c: gh pr create title 格式验证（~2ms）──────────────
# 拦截不符合 Conventional Commits 规范的 PR title，以及
# Engine 改动时缺少 [CONFIG] 标签的 PR title
# 降级原则：提取失败（格式奇怪）→ 放行
if echo "$CMD" | grep -qE '\bgh\s+pr\s+create\b'; then
    # 提取 --title "..." 或 --title '...'
    PR_TITLE=$(echo "$CMD" | sed -nE 's/.*--title[[:space:]]+"([^"]+)".*/\1/p' | head -1 || true)
    if [[ -z "$PR_TITLE" ]]; then
        PR_TITLE=$(echo "$CMD" | sed -nE "s/.*--title[[:space:]]+'([^']+)'.*/\1/p" | head -1 || true)
    fi

    if [[ -n "$PR_TITLE" ]]; then
        # 检查 Conventional Commits 格式
        # 允许可选的 [CONFIG] 前缀 + 类型(:) 或 类型(scope): 或 类型!:
        CC_PATTERN='^\[CONFIG\][[:space:]]*(feat|fix|docs|chore|test|refactor|build|ci|style|perf|revert)(\!|\([^)]+\))?:|^(feat|fix|docs|chore|test|refactor|build|ci|style|perf|revert)(\!|\([^)]+\))?:'
        if ! echo "$PR_TITLE" | grep -qE "$CC_PATTERN"; then
            echo "" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "  [BASH GUARD] PR title 不符合 Conventional Commits 格式" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "" >&2
            echo "  当前: $PR_TITLE" >&2
            echo "" >&2
            echo "  格式要求（以下之一）：" >&2
            echo "    feat: 描述" >&2
            echo "    fix(scope): 描述" >&2
            echo "    [CONFIG] feat: 描述" >&2
            echo "    feat!: 破坏性变更描述" >&2
            echo "" >&2
            exit 2
        fi

        # 检查 Engine 改动是否有 [CONFIG] 标签
        CHANGED_FILES=$(git diff --name-only HEAD 2>/dev/null || true)
        if echo "$CHANGED_FILES" | grep -q "packages/engine/"; then
            if ! echo "$PR_TITLE" | grep -q "\[CONFIG\]"; then
                echo "" >&2
                echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
                echo "  [BASH GUARD] Engine 改动的 PR title 必须包含 [CONFIG]" >&2
                echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
                echo "" >&2
                echo "  当前: $PR_TITLE" >&2
                echo "" >&2
                echo "  修改 packages/engine/ 的 PR title 必须以 [CONFIG] 开头：" >&2
                echo "    [CONFIG] feat(engine): 描述" >&2
                echo "    [CONFIG] fix(engine): 描述" >&2
                echo "" >&2
                exit 2
            fi
        fi
    fi
    # 提取失败（无 --title 参数或格式奇怪）→ 放行
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

# ─── 规则 5: .dev-mode Bash 写入检测（~3ms）──────────────────
# 拦截 Bash 工具对 .dev-mode 文件的 step_N: done 写操作
# 与 branch-protect.sh 的 Write/Edit 拦截形成对称保护
# 防止 AI 绕过 PreToolUse:Write，用 Bash 直接跳过状态机验证
if echo "$CMD" | grep -qE '\.dev-mode' && \
   echo "$CMD" | grep -qE 'step_(1_taskcard|2_code|4_learning):[[:space:]]*done'; then
    _VERIFY_STEP=""
    if echo "$CMD" | grep -qE 'step_1_taskcard:[[:space:]]*done'; then
        _VERIFY_STEP="step1"
    elif echo "$CMD" | grep -qE 'step_2_code:[[:space:]]*done'; then
        _VERIFY_STEP="step2"
    elif echo "$CMD" | grep -qE 'step_4_learning:[[:space:]]*done'; then
        _VERIFY_STEP="step4"
    fi
    if [[ -n "$_VERIFY_STEP" ]]; then
        _VS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/verify-step.sh"
        _VS_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
        _VS_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
        if [[ -f "$_VS" ]]; then
            if ! bash "$_VS" "$_VERIFY_STEP" "$_VS_BRANCH" "$_VS_ROOT" >&2; then
                echo "" >&2
                echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
                echo "  [BASH GUARD] .dev-mode Bash 写入被拦截" >&2
                echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
                echo "" >&2
                echo "  verify-step.sh ${_VERIFY_STEP} 验证失败" >&2
                echo "  请完成步骤再标记 done" >&2
                echo "" >&2
                exit 2
            fi
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
