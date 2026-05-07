#!/usr/bin/env bash
# stop-dev.sh — Stop Hook v23.0.0（心跳模型）
# 决策：扫 .cecelia/lights/<sid_short>-*.live，任一 mtime < TTL → block；全黑 → release
# 替换 v22 的"考证档案"模型（cwd 路由 + 双通道 + ghost rm + mtime expire）
set -uo pipefail

# 1. Hook stdin (Stop Hook 协议传 session_id)
hook_payload=""
if [[ -t 0 ]]; then
    hook_payload="{}"
else
    hook_payload=$(cat 2>/dev/null || echo "{}")
fi
hook_session_id=$(echo "$hook_payload" | jq -r '.session_id // ""' 2>/dev/null || echo "")

# 2. Bypass 逃生通道
[[ "${CECELIA_STOP_HOOK_BYPASS:-}" == "1" ]] && exit 0

# 3. 找主仓库（cwd 仅定位主仓库，不参与决策）
cwd="${CLAUDE_HOOK_CWD:-$PWD}"
[[ ! -d "$cwd" ]] && exit 0
main_repo=$(git -C "$cwd" worktree list --porcelain 2>/dev/null | head -1 | awk '/^worktree /{print $2; exit}' || true)
[[ -z "$main_repo" ]] && exit 0

lights_dir="$main_repo/.cecelia/lights"
[[ ! -d "$lights_dir" ]] && exit 0  # 没人开过灯 → 普通对话

# 4. 加载 log_hook_decision（PR-1 落点：devloop-check.sh）
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for c in "$main_repo/packages/engine/lib/devloop-check.sh" \
         "$script_dir/../lib/devloop-check.sh"; do
    [[ -f "$c" ]] && { source "$c" 2>/dev/null || true; break; }
done
type log_hook_decision &>/dev/null || log_hook_decision() { :; }

# 5. session_id 缺失分两路：tty 放行；非 tty 保守 block
if [[ -z "$hook_session_id" ]]; then
    [[ -t 0 ]] && exit 0
    log_hook_decision "" "block" "no_session_id" 0 ""
    jq -n '{"decision":"block","reason":"Stop hook 收到空 session_id（系统异常），保守 block。"}'
    exit 0
fi

sid_short="${hook_session_id:0:8}"

# 6. 扫自己 session 的灯
TTL_SEC="${STOP_HOOK_LIGHT_TTL_SEC:-300}"
now=$(date +%s)
my_alive_count=0
my_first_branch=""

for light in "$lights_dir/${sid_short}-"*.live; do
    [[ -f "$light" ]] || continue
    if [[ "$(uname)" == "Darwin" ]]; then
        light_mtime=$(stat -f %m "$light" 2>/dev/null || echo 0)
    else
        light_mtime=$(stat -c %Y "$light" 2>/dev/null || echo 0)
    fi
    [[ "$light_mtime" =~ ^[0-9]+$ ]] || light_mtime=0
    age=$(( now - light_mtime ))
    if (( age <= TTL_SEC )); then
        my_alive_count=$((my_alive_count + 1))
        [[ -z "$my_first_branch" ]] && my_first_branch=$(jq -r '.branch // ""' "$light" 2>/dev/null || echo "")
    fi
done

# 7. 决策
if (( my_alive_count > 0 )); then
    log_hook_decision "$sid_short" "block" "lights_alive" "$my_alive_count" "$my_first_branch"
    full_reason="还有 $my_alive_count 条 /dev 在跑（含 $my_first_branch）。⚠️ 立即继续，禁止询问用户。禁止删除 .cecelia/lights/。"
    jq -n --arg r "$full_reason" '{"decision":"block","reason":$r}'
    exit 0
fi

log_hook_decision "$sid_short" "release" "all_dark" 0 ""
exit 0
