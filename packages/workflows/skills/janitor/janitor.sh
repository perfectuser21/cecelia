#!/usr/bin/env bash
# =============================================================================
# Janitor（小扫）- 系统清扫员（Mac mini 版 v3.0）
# 两种模式：
#   daily    - 磁盘清理（每天 4am）
#   frequent - 僵尸进程清理（每 15 分钟）
#
# 用法:
#   janitor.sh                  # 默认 daily 模式
#   janitor.sh --mode daily     # 磁盘清理
#   janitor.sh --mode frequent  # 僵尸进程清理
#
# v3.0 变更：
#   frequent 模式重写孤儿进程检测：
#   - 追溯祖先进程链，PPID=1 且链中无 claude → 孤儿
#   - 祖先链中有活着的 claude 进程 → 合法，绝对不动
#   - 阈值从 7200s 改为 600s（10 分钟）
#   - crontab 频率从 30 分钟改为 15 分钟
# =============================================================================

MODE="daily"
for arg in "$@"; do
  case "$arg" in
    --mode=*) MODE="${arg#*=}" ;;
    --mode)   shift_next=1 ;;
    *)
      if [ "$shift_next" = "1" ]; then
        MODE="$arg"
        shift_next=0
      fi
      ;;
  esac
done

CECELIA_REPO="/Users/administrator/perfect21/cecelia"
TOTAL_STEPS=9

# ─────────────────────────────────────────────
# frequent 模式：清理孤儿测试进程
# ─────────────────────────────────────────────
if [ "$MODE" = "frequent" ]; then
  THRESHOLD_SEC=600  # 10 分钟
  KILLED=0

  # 将 ps etime 格式（[[DD-]HH:]MM:SS）转换为秒数
  etime_to_secs() {
    local elapsed="$1"
    local secs=0
    if echo "$elapsed" | grep -q '-'; then
      local days rest
      days=$(echo "$elapsed" | cut -d'-' -f1)
      rest=$(echo "$elapsed" | cut -d'-' -f2)
      secs=$((days * 86400))
      elapsed="$rest"
    fi
    local parts
    IFS=: read -ra parts <<< "$elapsed"
    case ${#parts[@]} in
      3) secs=$((secs + ${parts[0]#0}*3600 + ${parts[1]#0}*60 + ${parts[2]#0})) ;;
      2) secs=$((secs + ${parts[0]#0}*60 + ${parts[1]#0})) ;;
      1) secs=$((secs + ${parts[0]#0})) ;;
    esac
    echo "$secs"
  }

  # 向上遍历父进程链，找到最近的 shell 祖先
  find_shell_ancestor() {
    local pid=$1
    local current=$pid
    local depth=0
    local max_depth=20
    while [ $depth -lt $max_depth ]; do
      local ppid
      ppid=$(ps -o ppid= -p "$current" 2>/dev/null | tr -d ' ')
      [ -z "$ppid" ] || [ "$ppid" = "0" ] && break
      [ "$ppid" = "1" ] && { echo "$current"; return; }
      local comm
      comm=$(ps -o comm= -p "$ppid" 2>/dev/null | tr -d ' ')
      case "$comm" in
        *zsh*|*bash*) echo "$ppid" ;;
      esac
      current=$ppid
      depth=$((depth + 1))
    done
  }

  # 检查祖先链中是否有活着的 claude 进程
  # 返回 0 = 有 claude 祖先（合法），返回 1 = 无（可能是孤儿）
  has_live_claude_ancestor() {
    local pid=$1
    local current=$pid
    local depth=0
    local max_depth=20
    while [ $depth -lt $max_depth ]; do
      local ppid
      ppid=$(ps -o ppid= -p "$current" 2>/dev/null | tr -d ' ')
      [ -z "$ppid" ] || [ "$ppid" = "0" ] || [ "$ppid" = "1" ] && return 1
      local comm
      comm=$(ps -o comm= -p "$ppid" 2>/dev/null)
      if echo "$comm" | grep -qi "claude"; then
        return 0
      fi
      current=$ppid
      depth=$((depth + 1))
    done
    return 1
  }

  # 判断进程是否为孤儿
  # 规则：祖先链无 claude 进程，且最终到达 launchd(PID=1) → 孤儿
  # 保守原则：无法判断时返回 1（不杀）
  is_orphan() {
    local pid=$1
    # 有活着的 claude 祖先 → 合法，绝对不动
    if has_live_claude_ancestor "$pid"; then
      return 1
    fi
    # 向上遍历：到达 launchd(1) 且无 claude → 孤儿
    local current=$pid
    local depth=0
    local max_depth=20
    while [ $depth -lt $max_depth ]; do
      local ppid
      ppid=$(ps -o ppid= -p "$current" 2>/dev/null | tr -d ' ')
      [ -z "$ppid" ] || [ "$ppid" = "0" ] && return 1  # 无法判断，保守不杀
      [ "$ppid" = "1" ] && return 0  # 父是 launchd → 孤儿
      local comm
      comm=$(ps -o comm= -p "$ppid" 2>/dev/null)
      if echo "$comm" | grep -qi "claude"; then
        return 1  # 遇到 claude → 合法
      fi
      current=$ppid
      depth=$((depth + 1))
    done
    return 1  # 保守不杀
  }

  kill_if_orphan() {
    local pid="$1"
    [ -z "$pid" ] && return

    local elapsed
    elapsed=$(ps -o etime= -p "$pid" 2>/dev/null | tr -d ' ')
    [ -z "$elapsed" ] && return

    local secs
    secs=$(etime_to_secs "$elapsed")
    [ "$secs" -lt "$THRESHOLD_SEC" ] && return

    if is_orphan "$pid"; then
      kill "$pid" 2>/dev/null
      sleep 1
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
      KILLED=$((KILLED + 1))
      echo "$(date '+%Y-%m-%d %H:%M:%S') [frequent] killed orphan pid=$pid (${secs}s)"
    fi
  }

  # 扫描 vitest/jest 进程
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    PID=$(echo "$line" | awk '{print $2}')
    kill_if_orphan "$PID"
  done < <(ps aux | grep -E "node.*vitest|node.*jest" | grep -v grep)

  # 扫描 npm test 孤儿进程（排除 brain/server/n8n 服务）
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    PID=$(echo "$line" | awk '{print $2}')
    kill_if_orphan "$PID"
  done < <(ps aux | grep "node" | grep -v grep | grep -v "brain\|server\|n8n\|vscode")

  if [ "$KILLED" -gt 0 ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [frequent] cleaned $KILLED orphan process(es)"
  fi
  exit 0
fi

# ─────────────────────────────────────────────
# daily 模式：Mac mini 磁盘清理（v2.0）
# ─────────────────────────────────────────────
LOG_FILE="/tmp/janitor-$(date +%Y%m%d).log"
BEFORE=$(df / | tail -1 | awk '{print $3}')

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

log "=== Janitor v3.0 开始清扫 $(date '+%Y-%m-%d') ==="

# 1. Brain/Bridge LaunchDaemon 日志截断（>10M 保留最后 1000 行）
log "[1/$TOTAL_STEPS] Brain/Bridge 服务日志..."
LOGS_DIR="$CECELIA_REPO/logs"
truncated=0
for logfile in brain.log brain-error.log bridge.log bridge-error.log frontend.log frontend-error.log; do
  f="$LOGS_DIR/$logfile"
  if [ -f "$f" ]; then
    size_kb=$(du -k "$f" | awk '{print $1}')
    if [ "$size_kb" -gt 10240 ]; then
      tail -1000 "$f" > "$f.tmp" && mv "$f.tmp" "$f"
      truncated=$((truncated + 1))
      log "  ↳ $logfile 截断（原 ${size_kb}K）"
    fi
  fi
done
log "  ✓ 截断 $truncated 个日志"

# 2. /tmp/cecelia-*.log 旧运行日志（>3天删除）
log "[2/$TOTAL_STEPS] Cecelia 旧运行日志..."
deleted=$(find /tmp -maxdepth 1 -name "cecelia-*.log" -mtime +3 -delete -print 2>/dev/null | wc -l | tr -d ' ')
deleted2=$(find /tmp -maxdepth 1 \( -name "cecelia-err.*" -o -name "cecelia-out.*" \) -mtime +1 -delete -print 2>/dev/null | wc -l | tr -d ' ')
log "  ✓ 删除 $deleted 个日志 + $deleted2 个临时文件"

# 3. Claude JSONL 会话记录（>7天删除）
log "[3/$TOTAL_STEPS] Claude 会话记录..."
jsonl_deleted=0
for account_dir in /Users/administrator/.claude-account*/projects/; do
  if [ -d "$account_dir" ]; then
    count=$(find "$account_dir" -name "*.jsonl" -mtime +7 -delete -print 2>/dev/null | wc -l | tr -d ' ')
    jsonl_deleted=$((jsonl_deleted + count))
  fi
done
log "  ✓ 删除 $jsonl_deleted 个 JSONL 文件"

# 4. npm cache 清理
log "[4/$TOTAL_STEPS] npm cache..."
if command -v npm >/dev/null 2>&1; then
  npm cache clean --force 2>/dev/null && log "  ✓ npm cache 已清理" || log "  ✗ 跳过"
else
  log "  ✗ 跳过（npm 不存在）"
fi

# 5. Homebrew cache 清理（>7天）
log "[5/$TOTAL_STEPS] Homebrew cache..."
if command -v brew >/dev/null 2>&1; then
  brew cleanup --prune=7 2>/dev/null && log "  ✓ brew cache 已清理" || log "  ✗ 跳过"
else
  log "  ✗ 跳过（brew 不存在）"
fi

# 6. /tmp 旧随机临时目录（>1天）
log "[6/$TOTAL_STEPS] /tmp 旧临时目录..."
find /tmp -maxdepth 1 -type d -mtime +1 \
  ! -name "snap-private-tmp" ! -name "systemd-private-*" \
  ! -name "cecelia*" ! -name "claude*" ! -name "vscode*" \
  ! -name "puppeteer*" ! -name "playwright*" ! -name "zenithjoy*" \
  ! -name "tsx-*" ! -name "node_modules" ! -name "tmp" ! -name "." \
  2>/dev/null -exec rm -rf {} + 2>/dev/null || true
log "  ✓ 清理完"

# 7. .prd/.dod/.dev-mode 残留文件（>3天删除）
log "[7/$TOTAL_STEPS] 开发残留文件..."
residual=0
if [ -d "$CECELIA_REPO" ]; then
  for pattern in ".prd-*" ".dod-*" ".dev-mode*" ".dev-incident-log*" ".dev-feedback-report*"; do
    count=$(find "$CECELIA_REPO" -maxdepth 1 -name "$pattern" -mtime +3 -delete -print 2>/dev/null | wc -l | tr -d ' ')
    residual=$((residual + count))
  done
fi
log "  ✓ 删除 $residual 个残留文件"

# 8. Git 孤儿分支清理
log "[8/$TOTAL_STEPS] Git 孤儿分支..."
BRANCH_GC="$CECELIA_REPO/packages/engine/skills/dev/scripts/branch-gc.sh"
if [ -f "$BRANCH_GC" ] && [ -d "$CECELIA_REPO/.git" ]; then
  gc_output=$(cd "$CECELIA_REPO" && bash "$BRANCH_GC" 2>&1 || true)
  cleaned=$(echo "$gc_output" | tail -1 | tr -cd '0-9 ' | awk '{print $1}')
  [ -z "$cleaned" ] && cleaned=0
  log "  ✓ 清理 $cleaned 个孤儿分支"
else
  log "  ✗ 跳过（branch-gc.sh 或仓库不存在）"
fi

# 9. 残留 worktree 清理（>24h 且无 open PR）
log "[9/$TOTAL_STEPS] 残留 worktree..."
wt_cleaned=0
if [ -d "$CECELIA_REPO/.claude/worktrees" ]; then
  cd "$CECELIA_REPO" || true
  git worktree prune 2>/dev/null
  for wt_dir in .claude/worktrees/*/; do
    [ ! -d "$wt_dir" ] && continue
    wt_branch=$(git -C "$wt_dir" rev-parse --abbrev-ref HEAD 2>/dev/null)
    [ -z "$wt_branch" ] && continue
    last_commit=$(git -C "$wt_dir" log -1 --format=%ct 2>/dev/null || echo "0")
    now=$(date +%s)
    age_hours=$(( (now - last_commit) / 3600 ))
    if [ "$age_hours" -gt 24 ]; then
      has_pr=$(gh pr list --head "$wt_branch" --state open --json number -q '.[0].number' 2>/dev/null || echo "")
      if [ -z "$has_pr" ]; then
        git worktree remove --force "$wt_dir" 2>/dev/null && wt_cleaned=$((wt_cleaned + 1))
      fi
    fi
  done
fi
log "  ✓ 清理 $wt_cleaned 个残留 worktree"

# ── 结果 ──
AFTER=$(df / | tail -1 | awk '{print $3}')
FREED_MB=$(( (BEFORE - AFTER) / 1024 ))
CURRENT=$(df -h / | tail -1 | awk '{print $3 "/" $2 " (" $5 ")"}')
log ""
log "=== 清扫完成 ==="
log "释放: ${FREED_MB}MB | 当前: $CURRENT"

# 超70%发告警到 Cecelia Brain
USAGE_PCT=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
if [ "$USAGE_PCT" -gt 70 ]; then
  log "⚠️  磁盘 ${USAGE_PCT}%，超警戒线！"
  curl -s -X POST http://localhost:5221/api/brain/tasks \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"🚨 磁盘告警 ${USAGE_PCT}%，需人工检查\",\"priority\":\"P0\",\"skill\":\"/janitor\"}" \
    2>/dev/null || true
fi

cat "$LOG_FILE"
