#!/usr/bin/env bash
# sync-skills-snapshot.sh — 把 harness skill 的 SKILL.md 从 SSOT 同步到 monorepo 快照。
#
# 背景：所有 skill 的唯一 SSOT = zenithjoy-skills repo（见 ~/.claude/CLAUDE.md skills-architecture）。
# packages/workflows/skills/ 是给 monorepo CI / evaluator 读的「快照拷贝」，不是 SSOT。
# Brain 的 harness graph 用 loadSkillContent() 读快照里的 SKILL.md 注入给 agent，
# 快照漂移 = agent 跑的是旧 skill。本脚本负责把 6 个 harness skill 的 SKILL.md 刷成最新。
#
# 用法：
#   bash scripts/sync-skills-snapshot.sh
#   SKILLS_SSOT_DIR=/path/to/zenithjoy-skills bash scripts/sync-skills-snapshot.sh
#
# 行为：逐个 cp 源 SKILL.md → 目标快照，结尾输出 diff 统计；源缺失则报错退出（非 0）。

set -euo pipefail

SSOT_DIR="${SKILLS_SSOT_DIR:-$HOME/perfect21/zenithjoy-skills}"

# 目标快照目录：相对脚本位置定位 repo 根（scripts/ 的上一级）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST_DIR="$REPO_ROOT/packages/workflows/skills"

SKILLS=(
  harness-controller
  harness-planner
  harness-contract-proposer
  harness-contract-reviewer
  harness-generator
  harness-evaluator
  harness-report
  line-strategist
  capability-controller
  capability-proposer
  capability-reviewer
  capability-mapper
)

if [[ ! -d "$SSOT_DIR" ]]; then
  echo "[ERROR] SSOT 目录不存在: $SSOT_DIR" >&2
  echo "        请设置 SKILLS_SSOT_DIR 指向 zenithjoy-skills repo" >&2
  exit 1
fi

echo "[sync-skills-snapshot] SSOT=$SSOT_DIR → DEST=$DEST_DIR"

synced=0
for skill in "${SKILLS[@]}"; do
  src="$SSOT_DIR/$skill/SKILL.md"
  if [[ ! -f "$src" ]]; then
    echo "[ERROR] 源 SKILL.md 缺失: $src" >&2
    exit 1
  fi
  dest="$DEST_DIR/$skill/SKILL.md"
  mkdir -p "$DEST_DIR/$skill"

  if [[ -f "$dest" ]]; then
    added=$(diff <(cat "$dest") <(cat "$src") | grep -c '^>' || true)
    removed=$(diff <(cat "$dest") <(cat "$src") | grep -c '^<' || true)
  else
    added=$(wc -l < "$src" | tr -d ' ')
    removed=0
  fi

  cp "$src" "$dest"
  echo "  ✓ $skill  (+${added} / -${removed} 行)"
  synced=$((synced + 1))
done

echo "[sync-skills-snapshot] 完成：同步 $synced 个 skill 的 SKILL.md"
