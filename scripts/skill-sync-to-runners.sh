#!/usr/bin/env bash
# skill-sync-to-runners.sh — 把 MMV 的 skill 真身同步到跑场机，并用清单哈希校验结果。
#
# 取代 MMV 用户 crontab 里那行 `# skill-sync-to-runners`（rsync -az 无 -L、无 --delete、无校验、不在仓库）。
# 那行 09-25 被实测证伪：真身顶层几乎全是符号链接，`rsync -a` 把链接原样拷过去，跑场机上全部悬空
# （M1 133/133），条目数对得上、内容为零。本脚本用 `rsync -L` 送真内容，并在同步后重算清单比对。
#
# 用法：
#   skill-sync-to-runners.sh                    # 默认 --dry-run：只核对清单、打印将做的事，不写任何远端
#   skill-sync-to-runners.sh --apply            # 真同步（不删目标多余项；有多余项则退出 1 提示加 --prune）
#   skill-sync-to-runners.sh --apply --prune    # 真同步并删目标多余项（rsync --delete，目标上的 .git 受保护）
#
# 环境变量：
#   SKILL_SYNC_TARGETS   目标 ssh 别名，空格分隔（默认 "xian-m4 xian-m1"；别名以本机 ~/.ssh/config 为准，不写 IP）
#   SKILL_SYNC_SRC       真身目录（默认 ~/.claude/skills）
#   SKILL_SYNC_SSH       ssh 可执行文件（默认 ssh；测试注入假实现）
#
# 每个目标同步两处（同旧 cron 的两跳）：~/.claude/skills，再镜像到 ~/.codex-gwremote/skills。
# 排除顶层隐藏项（.git/.gitignore 等）与 .DS_Store / node_modules / __pycache__（与清单忽略集一致；被排除的项
# 既不传输也不会被 --delete 删除，所以目标上的 .git、.gitignore 受保护）。
# 真身里的悬空符号链接（无内容，MMV 实测 29 个）不参与同步，点名告警；目标上同名残留在 --prune 时被删。
#
# 退出码：0 全部一致（或 dry-run 完成）；1 同步后与真身仍不一致；2 目标/真身取清单失败（不可达≠零个 skill）；
#         64 用法错误。
set -u

MODE=""
PRUNE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) [ "$MODE" = "apply" ] && { echo "用法错误：--apply 与 --dry-run 互斥" >&2; exit 64; }; MODE="dry-run" ;;
    --apply)   [ "$MODE" = "dry-run" ] && { echo "用法错误：--apply 与 --dry-run 互斥" >&2; exit 64; }; MODE="apply" ;;
    --prune)   PRUNE=1 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "用法错误：未知参数 ${arg}（见 --help）" >&2; exit 64 ;;
  esac
done
[ -z "$MODE" ] && MODE="dry-run"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST_SH="$SCRIPT_DIR/../packages/brain/src/lib/skill-manifest.sh"
SRC="${SKILL_SYNC_SRC:-$HOME/.claude/skills}"
TARGETS="${SKILL_SYNC_TARGETS:-xian-m4 xian-m1}"
SSH_BIN="${SKILL_SYNC_SSH:-ssh}"
SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=10"

for t in $TARGETS; do
  case "$t" in
    *[!A-Za-z0-9._-]*|-*|"") echo "目标别名非法：$t" >&2; exit 64 ;;
  esac
done

tree_hash_of() { printf '%s' "$1" | sed -n 's/.*"tree_hash":"\([0-9a-f]*\)".*/\1/p'; }
count_of()     { printf '%s' "$1" | sed -n 's/.*"count":\([0-9]*\).*/\1/p'; }

# 真身清单
truth_json="$(bash "$MANIFEST_SH" "$SRC" 2>/dev/null)"; rc=$?
if [ $rc -ne 0 ]; then
  echo "❌ 真身目录取清单失败（rc=${rc}）：${SRC} —— 不同步任何目标" >&2
  exit 2
fi
truth_hash="$(tree_hash_of "$truth_json")"
echo "[skill-sync] 模式=$MODE prune=$PRUNE 真身=$SRC skills=$(count_of "$truth_json") tree_hash=${truth_hash:0:12}"

# 暂存视图：只含真身里「有内容」的 skill（符号链接原样指过去，rsync -L 跟随送真内容）。
# 不用 --exclude 排悬空项：那样目标上同名残留会被排除规则保护、--delete 删不掉。
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/skill-sync-stage.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
broken_names=""
for e in "$SRC"/*; do
  { [ -e "$e" ] || [ -L "$e" ]; } || continue
  name="${e##*/}"
  if [ -L "$e" ] && [ ! -e "$e" ]; then broken_names="$broken_names $name"; continue; fi
  [ -d "$e" ] || continue
  ln -s "$e" "$STAGE/$name"
done
if [ -n "$broken_names" ]; then
  echo "⚠️  真身有悬空符号链接（无内容，未同步；这是真身自己的问题）：$(printf '%s' "$broken_names" | wc -w | tr -d ' ') 个 →$broken_names"
fi

EXCLUDES="--exclude=/.* --exclude=.git --exclude=.DS_Store --exclude=node_modules --exclude=__pycache__"
DELETE=""
[ "$PRUNE" = 1 ] && DELETE="--delete"
RSH="$SSH_BIN $SSH_OPTS"

remote_manifest() { # $1=别名 $2=目录 token；stdout=JSON，返回 ssh/脚本退出码
  $SSH_BIN $SSH_OPTS "$1" bash -s -- "$2" < "$MANIFEST_SH" 2>/dev/null
}

final=0
bump() { # 退出码优先级：2 > 1 > 0
  if [ "$1" = 2 ] || { [ "$1" = 1 ] && [ "$final" = 0 ]; }; then final="$1"; fi
}

check_dir() { # $1=别名 $2=label $3=目录 token $4=pre|post → 0 一致 / 1 不一致 / 2 取不到
  # pre = 同步前的现状（不一致是预期，用 ⚠️）；post = 同步后的结果（不一致才是 ❌ 失败）
  local t="$1" label="$2" token="$3" phase="${4:-post}" out rc mark="❌"
  [ "$phase" = pre ] && mark="⚠️ "
  out="$(remote_manifest "$t" "$token")"; rc=$?
  if [ $rc -eq 3 ]; then echo "  $mark $t $label 目录不存在（与真身不一致）"; return 1; fi
  if [ $rc -ne 0 ] || [ -z "$(tree_hash_of "$out")" ]; then
    echo "  ❌ $t $label 取清单失败（rc=${rc}，unreachable/不可达，未核对，不当作零个 skill）"; return 2
  fi
  if [ "$(tree_hash_of "$out")" = "$truth_hash" ]; then
    echo "  ✓ $t $label 与真身一致（skills=$(count_of "$out")）"; return 0
  fi
  echo "  $mark $t $label 与真身不一致：skills=$(count_of "$out")（真身 $(count_of "$truth_json")）漂移"
  return 1
}

for t in $TARGETS; do
  echo "== $t =="
  check_dir "$t" claude "@home/.claude/skills" pre; c1=$?
  if [ $c1 -eq 2 ]; then bump 2; echo "  跳过该目标"; continue; fi

  rsync_cmd="rsync -azL --timeout=60 $DELETE $EXCLUDES -e '$RSH' <stage>/ $t:.claude/skills/"
  rsync_cmd="$(printf '%s' "$rsync_cmd" | tr -s ' ')"

  if [ "$MODE" = "dry-run" ]; then
    echo "  [dry-run] 将执行：$rsync_cmd"
    echo "  [dry-run] 然后在目标上镜像到 ~/.codex-gwremote/skills 并重算清单比对（本次不执行）"
    plan="$(rsync -azLn -i --timeout=60 $DELETE $EXCLUDES -e "$RSH" "$STAGE/" "$t:.claude/skills/" 2>&1)"
    n="$(printf '%s\n' "$plan" | grep -c '^[<>c*.]' || true)"
    echo "  [dry-run] rsync -n 预演：$n 项将变更（前 15 项）"
    printf '%s\n' "$plan" | grep '^[<>c*.]' | head -15 | sed 's/^/    /'
    continue
  fi

  # --apply
  $SSH_BIN $SSH_OPTS "$t" 'mkdir -p ~/.claude/skills ~/.codex-gwremote/skills' 2>/dev/null
  # shellcheck disable=SC2086
  rsync -azL --timeout=60 $DELETE $EXCLUDES -e "$RSH" "$STAGE/" "$t:.claude/skills/"; rrc=$?
  if [ $rrc -ne 0 ]; then echo "  ❌ $t rsync 失败（rc=${rrc}）"; bump 1; continue; fi
  # 第二跳：~/.claude/skills → ~/.codex-gwremote/skills（同旧 cron；此时前者已是真内容）
  $SSH_BIN $SSH_OPTS "$t" "rsync -a $DELETE $EXCLUDES ~/.claude/skills/ ~/.codex-gwremote/skills/"; mrc=$?
  if [ $mrc -ne 0 ]; then echo "  ❌ $t 镜像到 codex-gwremote 失败（rc=${mrc}）"; bump 1; continue; fi

  bad=0
  check_dir "$t" claude "@home/.claude/skills"; r=$?; [ $r -ne 0 ] && { bump "$r"; bad=1; }
  check_dir "$t" codex-gwremote "@home/.codex-gwremote/skills"; r=$?; [ $r -ne 0 ] && { bump "$r"; bad=1; }
  if [ $bad -eq 1 ] && [ "$PRUNE" != 1 ]; then
    echo "  ℹ️  未带 --prune：目标上多出的项不会被删，加 --prune 才能收敛到与真身完全一致"
  fi
done

case "$final" in
  0) echo "[skill-sync] 完成：全部目标与真身一致（或 dry-run 仅预演）" ;;
  1) echo "[skill-sync] ❌ 有目标同步后与真身仍不一致，退出 1" ;;
  2) echo "[skill-sync] ❌ 有目标不可达/取不到清单（未核对），退出 2" ;;
esac
exit "$final"
