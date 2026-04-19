#!/usr/bin/env bash
# sync-from-upstream.sh — Superpowers upstream drift 检测
#
# 用法:
#   bash packages/engine/scripts/sync-from-upstream.sh [--verbose]
#
# 做什么:
#   1. 从 ~/.claude-account1/plugins/cache/superpowers-marketplace/superpowers/*/
#      找到当前激活的 Superpowers 源目录
#   2. 对比 packages/engine/skills/dev/prompts/<skill>/<file> 的 sha256
#      与 upstream 对应 sha256
#   3. drift 列表 → stdout + exit 1
#      零 drift → [OK] + exit 0
#
# 升级 workflow:
#   ① 本脚本报告 drift 列表
#   ② 人工 diff 每个 drift 文件 (upstream vs local) 决定:
#      a. 同步 → cp upstream → local, 更新 alignment.yaml sha256
#      b. 刻意偏离 → 记录到 alignment.yaml notes, 保持 local 不变
#   ③ 更新 _metadata.superpowers_upstream_version
#   ④ 跑 check-superpowers-alignment.cjs 验证新 sha256 匹配
#
# 原则: Engine = Superpowers 自动化适配层. 不魔改原 prompt,
# 本脚本是升级同步的"雷达"

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

VERBOSE=0
[[ "${1:-}" == "--verbose" ]] && VERBOSE=1

# 1. 找 Superpowers upstream
SP_CACHE=~/.claude-account1/plugins/cache/superpowers-marketplace/superpowers
if [[ ! -d "$SP_CACHE" ]]; then
    echo "[sync-from-upstream] ERROR: Superpowers cache not found at $SP_CACHE"
    exit 2
fi

# 找最新版本 (按目录名排序, 5.0.7 前的版本用 semver 不靠谱, 简单取最后一个)
UPSTREAM_VER=$(ls "$SP_CACHE" 2>/dev/null | sort -V | tail -1)
UPSTREAM_ROOT="$SP_CACHE/$UPSTREAM_VER/skills"

if [[ ! -d "$UPSTREAM_ROOT" ]]; then
    echo "[sync-from-upstream] ERROR: $UPSTREAM_ROOT not a directory"
    exit 2
fi

echo "[sync-from-upstream] upstream: $UPSTREAM_VER at $UPSTREAM_ROOT"
echo "[sync-from-upstream] local prompts: packages/engine/skills/dev/prompts/"

# 2. 对比本地 prompts 目录每个文件 sha256
LOCAL_DIR="packages/engine/skills/dev/prompts"
DRIFT_COUNT=0
NEW_UPSTREAM=0
declare -a DRIFT_LIST
declare -a NEW_LIST

# 辅助函数: 计算 sha256 (跨平台)
_sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        shasum -a 256 "$1" | awk '{print $1}'
    fi
}

# 对每个本地 skill 目录
for skill_dir in "$LOCAL_DIR"/*/; do
    skill=$(basename "$skill_dir")
    for local_file in "$skill_dir"*.md; do
        [[ -f "$local_file" ]] || continue
        filename=$(basename "$local_file")
        upstream_file="$UPSTREAM_ROOT/$skill/$filename"
        if [[ ! -f "$upstream_file" ]]; then
            DRIFT_LIST+=("$skill/$filename [LOCAL_ONLY] upstream file missing")
            DRIFT_COUNT=$((DRIFT_COUNT + 1))
            continue
        fi
        local_sha=$(_sha256 "$local_file")
        upstream_sha=$(_sha256 "$upstream_file")
        if [[ "$local_sha" != "$upstream_sha" ]]; then
            DRIFT_LIST+=("$skill/$filename local=$local_sha upstream=$upstream_sha")
            DRIFT_COUNT=$((DRIFT_COUNT + 1))
        elif [[ $VERBOSE -eq 1 ]]; then
            echo "[OK] $skill/$filename (sha256 match)"
        fi
    done
done

# 3. 发现 upstream 新 skill 但本地未吸收
for upstream_skill_dir in "$UPSTREAM_ROOT"/*/; do
    upstream_skill=$(basename "$upstream_skill_dir")
    if [[ ! -d "$LOCAL_DIR/$upstream_skill" ]]; then
        # 本地没这个 skill 目录. 是 using-superpowers/writing-skills 这种 meta 就跳过,
        # 否则标记为潜在新 skill
        case "$upstream_skill" in
            using-superpowers|writing-skills|using-git-worktrees)
                [[ $VERBOSE -eq 1 ]] && echo "[skip] $upstream_skill (alignment.yaml 明确 N/A or rejected)"
                ;;
            *)
                NEW_LIST+=("$upstream_skill [NEW_UPSTREAM] 本地未吸收, 请评估是否加入 alignment.yaml")
                NEW_UPSTREAM=$((NEW_UPSTREAM + 1))
                ;;
        esac
    fi
done

# 4. 输出报告
echo ""
if [[ $DRIFT_COUNT -eq 0 && $NEW_UPSTREAM -eq 0 ]]; then
    echo "[OK] 所有本地 prompt 与 upstream $UPSTREAM_VER sha256 一致, 无新 upstream skill"
    exit 0
fi

if [[ $DRIFT_COUNT -gt 0 ]]; then
    echo "[DRIFT] $DRIFT_COUNT 个本地文件与 upstream 不一致:"
    for item in "${DRIFT_LIST[@]}"; do
        echo "  - $item"
    done
fi

if [[ $NEW_UPSTREAM -gt 0 ]]; then
    echo ""
    echo "[NEW] $NEW_UPSTREAM 个 upstream 新 skill 本地未吸收:"
    for item in "${NEW_LIST[@]}"; do
        echo "  - $item"
    done
fi

echo ""
echo "[next-step] 人工决策:"
echo "  (a) 同步: cp <upstream> <local>, 更新 alignment.yaml 中 local_prompt.sha256"
echo "  (b) 刻意偏离: 不动 local, 在 alignment.yaml 的 notes 里说明原因"
echo "  新 skill: 评估是否加入 alignment.yaml (full/partial/rejected)"

exit 1
