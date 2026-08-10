#!/usr/bin/env bash
# =============================================================================
# Janitor（小扫）- 系统清扫员（Cecelia DevOps 版 v5.0）
# 两种模式：
#   daily    - 磁盘清理（每天 4am）
#   frequent - 僵尸/孤儿进程清理（每 15 分钟）
#
# v5.0 变更（janitor-devops-homecoming，task 61f7a4dd）：
#   - 从 zenithjoy-skills 迁入 cecelia scripts/ops/janitor.sh
#   - 步骤8：内联孤儿分支清理（外部 gc 脚本调用已移除，改为直接 git branch -d）
#   - 步骤9：扫描 ~/worktrees/{cecelia,zenithjoy}，Guard A 三查
#   - FAIL 显式化：N>0 但 M=0 时记 FAILED_STEPS，退出码非零
#   - Brain 告警 description 非空且含磁盘水位
#   - 水位台账：~/logs/janitor-ledger.csv 每次追加一行
#   - --dry-run 模式：只检测不清理，退出码 0
#   - 支持 DISK_PCT / BRAIN_URL 环境变量注入（测试用）
# =============================================================================

MODE="daily"
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --mode=*) MODE="${arg#*=}" ;;
    --mode)   _next_is_mode=1 ;;
    --dry-run) DRY_RUN=true ;;
    *)
      if [ "${_next_is_mode:-0}" = "1" ]; then
        MODE="$arg"
        _next_is_mode=0
      fi
      ;;
  esac
done

# cron 默认 PATH 只有 /usr/bin:/bin，找不到装在 /opt/homebrew/bin 的 npm/brew/docker
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

CECELIA_REPO="$(cd "$(dirname "$0")/../.." && pwd)"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
TOTAL_STEPS=10
# 磁盘用量查数据卷；APFS 下 / 是只读系统卷 firmlink，数据在 /System/Volumes/Data
DISK_VOL="${DISK_VOL:-/System/Volumes/Data}"
# 如 DISK_VOL 不存在（非 macOS），退化到 /
[ -d "$DISK_VOL" ] || DISK_VOL="/"

FAILED_STEPS=""

# dry-run 日志前缀
if $DRY_RUN; then
  DRY_TAG="[DRY-RUN] "
else
  DRY_TAG=""
fi

# ─────────────────────────────────────────────
# frequent 模式：清理孤儿/僵尸进程 + 资源压力响应
# ─────────────────────────────────────────────
if [ "$MODE" = "frequent" ]; then
  THRESHOLD_SEC=600          # 正常阈值：10 分钟
  MEM_HIGH_THRESHOLD_SEC=300 # 内存高压阈值：5 分钟
  CPU_ALERT_THRESHOLD=85     # CPU 高压告警触发点（%）
  MEM_HIGH_WATERMARK=90      # 内存高压水位（%）
  KILLED=0

  # ── 检测当前资源压力 ──────────────────────────────
  _get_mem_usage_pct() {
    local total pagesize pages_free pages_spec free_bytes
    total=$(sysctl -n hw.memsize 2>/dev/null || echo "0")
    pagesize=$(sysctl -n hw.pagesize 2>/dev/null || echo "4096")
    pages_free=$(vm_stat 2>/dev/null | awk '/Pages free/{gsub(/\./,"",$3); print $3+0}')
    pages_spec=$(vm_stat 2>/dev/null | awk '/Pages speculative/{gsub(/\./,"",$3); print $3+0}')
    pages_free=${pages_free:-0}
    pages_spec=${pages_spec:-0}
    free_bytes=$(( (pages_free + pages_spec) * pagesize ))
    if [ "$total" -gt 0 ]; then
      echo $(( (total - free_bytes) * 100 / total ))
    else
      echo 0
    fi
  }

  _get_cpu_usage_pct() {
    local load cores
    load=$(sysctl -n vm.loadavg 2>/dev/null | awk '{gsub(/[{}]/,"",$2); print $2}')
    cores=$(sysctl -n hw.logicalcpu 2>/dev/null || echo "1")
    [ -z "$load" ] || [ "$cores" -eq 0 ] && echo 0 && return
    awk "BEGIN{pct=$load/$cores*100; if(pct>100)pct=100; printf \"%d\", pct}"
  }

  MEM_PCT=$(_get_mem_usage_pct)
  CPU_PCT=$(_get_cpu_usage_pct)

  # 内存高压：降低清理阈值
  ACTIVE_THRESHOLD=$THRESHOLD_SEC
  if [ "$MEM_PCT" -ge "$MEM_HIGH_WATERMARK" ] 2>/dev/null; then
    ACTIVE_THRESHOLD=$MEM_HIGH_THRESHOLD_SEC
    echo "$(date '+%Y-%m-%d %H:%M:%S') [frequent] 内存高压 ${MEM_PCT}%，清理阈值降至 ${MEM_HIGH_THRESHOLD_SEC}s"
  fi

  # CPU 高压：上报 Brain 告警
  if [ "$CPU_PCT" -ge "$CPU_ALERT_THRESHOLD" ] 2>/dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [frequent] CPU 高压 ${CPU_PCT}%，上报 Brain 告警..."
    curl -s -X POST "${BRAIN_URL}/api/brain/tasks" \
      -H "Content-Type: application/json" \
      -d "{\"title\":\"⚠️ CPU 高压告警 ${CPU_PCT}%（Janitor 检测）\",\"priority\":\"P1\",\"task_type\":\"alert\",\"domain\":\"agent_ops\",\"description\":\"CPU ${CPU_PCT}% 超过 ${CPU_ALERT_THRESHOLD}% 阈值，请检查是否有失控进程。\"}" \
      2>/dev/null || true
  fi

  # ── 工具函数 ──────────────────────────────────────
  # etime 格式（[[DD-]HH:]MM:SS）转秒数；非法输入返回 0。
  # 勿删 10#：前导零会被 bash 按八进制解析，days=08/09（进程运行满 8 天）曾致命报错
  etime_to_secs() {
    local elapsed="$1"
    local secs=0
    local re='^([0-9]+-)?[0-9]{1,2}(:[0-9]{2}){0,2}$'
    if ! [[ "$elapsed" =~ $re ]]; then
      echo 0
      return
    fi
    if echo "$elapsed" | command grep -q '-'; then
      local days rest
      days=$(echo "$elapsed" | cut -d'-' -f1)
      rest=$(echo "$elapsed" | cut -d'-' -f2)
      secs=$((10#$days * 86400))
      elapsed="$rest"
    fi
    local parts
    IFS=: read -ra parts <<< "$elapsed"
    case ${#parts[@]} in
      3) secs=$((secs + 10#${parts[0]}*3600 + 10#${parts[1]}*60 + 10#${parts[2]})) ;;
      2) secs=$((secs + 10#${parts[0]}*60 + 10#${parts[1]})) ;;
      1) secs=$((secs + 10#${parts[0]})) ;;
    esac
    echo "$secs"
  }

  # 向上遍历父进程链，找最近 shell 祖先
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

  # Brain DB 检查：是否有 in_progress 任务
  has_brain_inprogress_task() {
    local resp
    resp=$(curl -s --max-time 3 "${BRAIN_URL}/api/brain/tasks?status=in_progress&limit=50" 2>/dev/null)
    [ -z "$resp" ] && return 0  # Brain 不可达 → 保守
    local count
    count=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "0")
    [ "$count" -gt 0 ] && return 0
    return 1
  }

  # .dev-lock 检查：是否有活跃 dev session
  has_active_dev_lock() {
    local wt_dir="$CECELIA_REPO/.claude/worktrees"
    if [ -d "$wt_dir" ]; then
      local lock_count
      lock_count=$(find "$wt_dir" -maxdepth 2 -name ".dev-lock.*" 2>/dev/null | wc -l | tr -d ' ')
      [ "$lock_count" -gt 0 ] && return 0
    fi
    local main_lock
    main_lock=$(find "$CECELIA_REPO" -maxdepth 1 -name ".dev-lock.*" 2>/dev/null | wc -l | tr -d ' ')
    [ "$main_lock" -gt 0 ] && return 0
    return 1
  }

  # 判断 vitest/node 进程是否为孤儿（三层保护）
  is_orphan() {
    local pid=$1

    # 保护层 A：TTY 检查——有 TTY 的进程绝对不杀
    local tty
    tty=$(ps -o tty= -p "$pid" 2>/dev/null | tr -d ' ')
    if [ -n "$tty" ] && [ "$tty" != "??" ]; then
      return 1
    fi

    # 保护层 B：祖先链遍历——找到 tmux/screen/sshd/login/claude → 不杀
    local current=$pid
    local depth=0
    local max_depth=20
    while [ $depth -lt $max_depth ]; do
      local ppid
      ppid=$(ps -o ppid= -p "$current" 2>/dev/null | tr -d ' ')
      [ -z "$ppid" ] || [ "$ppid" = "0" ] && break
      [ "$ppid" = "1" ] && break
      local comm
      comm=$(ps -o comm= -p "$ppid" 2>/dev/null)
      if echo "$comm" | grep -qiE "tmux|screen|sshd|login|claude"; then
        return 1
      fi
      current=$ppid
      depth=$((depth + 1))
    done

    # 保护层 C：cmdline 白名单——brain/server.js、cecelia-bridge.cjs、n8n → 不杀
    local cmdline
    cmdline=$(ps -o command= -p "$pid" 2>/dev/null || echo "")
    if echo "$cmdline" | grep -qE "brain/server\.js|cecelia-bridge\.cjs|n8n"; then
      return 1
    fi

    # 最终判断：PPID=1 → 真实孤儿
    local ppid_final
    ppid_final=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    [ "$ppid_final" = "1" ] && return 0

    return 1
  }

  # 判断 claude 进程是否为孤儿（双重验证）
  is_claude_orphan() {
    local pid=$1
    local tty=$2
    local ppid=$3

    # 条件1: 无终端（有头进程绝对不动）
    [ "$tty" != "??" ] && return 1

    # 条件2: ppid=1（父进程已死）
    [ "$ppid" != "1" ] && return 1

    # 条件3: 白名单服务进程不动
    local cmdline
    cmdline=$(ps -o command= -p "$pid" 2>/dev/null || echo "")
    if echo "$cmdline" | grep -qE "brain/server\.js|cecelia-bridge\.cjs|n8n"; then
      return 1
    fi

    # 条件4（保守）: Brain 有 in_progress 任务 → 跳过
    if has_brain_inprogress_task; then
      return 1
    fi

    # 条件5（保守）: 有 .dev-lock 文件 → 跳过
    if has_active_dev_lock; then
      return 1
    fi

    return 0
  }

  # vitest/node 通用 kill 函数
  kill_if_orphan() {
    local pid="$1"
    local threshold="${2:-$ACTIVE_THRESHOLD}"
    [ -z "$pid" ] && return

    local elapsed secs
    elapsed=$(ps -o etime= -p "$pid" 2>/dev/null | tr -d ' ')
    [ -z "$elapsed" ] && return
    secs=$(etime_to_secs "$elapsed")
    [ -z "$secs" ] && { echo "$(date '+%Y-%m-%d %H:%M:%S') [frequent] etime_to_secs 解析失败 elapsed=$elapsed pid=$pid，保守跳过"; secs=0; }
    [ "$secs" -lt "$threshold" ] && return

    # cecelia 常驻服务豁免（fleet-worker/toolchain 等）
    local cmd
    cmd=$(ps -o command= -p "$pid" 2>/dev/null)
    case "$cmd" in *"/usr/local/libexec/cecelia/"*) return ;; esac

    if is_orphan "$pid"; then
      kill "$pid" 2>/dev/null
      sleep 1
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
      # kill 后复查：无 sudo 杀非本人进程会 EPERM 静默失败，仍存活 → 打 kill-failed 不计数
      sleep 1
      if kill -0 "$pid" 2>/dev/null; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') [frequent] kill-failed node/vitest pid=$pid 仍存活（疑似权限不足），不计数"
        return
      fi
      KILLED=$((KILLED + 1))
      echo "$(date '+%Y-%m-%d %H:%M:%S') [frequent] killed node/vitest orphan pid=$pid (${secs}s)"
    fi
  }

  # kill 后回报 Brain
  notify_brain_orphan_killed() {
    local pid="$1" cwd="$2"
    [ -z "$cwd" ] && return 0

    local lockfile branch
    lockfile=$(ls "$cwd"/.dev-lock.* 2>/dev/null | head -1)
    [ -z "$lockfile" ] && return 0

    branch=$(grep "^branch:" "$lockfile" 2>/dev/null | awk '{print $2}' | tr -d '[:space:]')
    [ -z "$branch" ] && return 0

    echo "$(date '+%Y-%m-%d %H:%M:%S') [frequent] 孤儿回报 Brain：pid=$pid branch=$branch"

    local task_id
    task_id=$(grep "^task_id:" "$lockfile" 2>/dev/null | awk '{print $2}' | tr -d '[:space:]')

    if [ -n "$task_id" ]; then
      curl -s --max-time 5 -X PATCH "${BRAIN_URL}/api/brain/tasks/${task_id}" \
        -H "Content-Type: application/json" \
        -d "{\"status\":\"failed\",\"custom_props\":{\"fail_reason\":\"orphan_killed_by_janitor\",\"branch\":\"${branch}\",\"killed_pid\":${pid}}}" \
        > /dev/null 2>&1 || true
      echo "$(date '+%Y-%m-%d %H:%M:%S') [frequent] Brain 已更新：task=${task_id} → failed (orphan_killed_by_janitor)"
    else
      curl -s --max-time 5 -X POST "${BRAIN_URL}/api/brain/tasks" \
        -H "Content-Type: application/json" \
        -d "{\"title\":\"[janitor] 孤儿分支 ${branch} 任务需重调度\",\"task_type\":\"alert\",\"priority\":\"p2\",\"description\":\"orphan_killed_by_janitor: pid=${pid} branch=${branch}\"}" \
        > /dev/null 2>&1 || true
      echo "$(date '+%Y-%m-%d %H:%M:%S') [frequent] Brain 已告警：分支=$branch 需重调度 (orphan_killed_by_janitor)"
    fi
  }

  # claude 专用 kill 函数
  kill_if_claude_orphan() {
    local pid="$1" tty="$2" ppid="$3"
    local threshold="${4:-$ACTIVE_THRESHOLD}"
    [ -z "$pid" ] && return

    local elapsed secs
    elapsed=$(ps -o etime= -p "$pid" 2>/dev/null | tr -d ' ')
    [ -z "$elapsed" ] && return
    secs=$(etime_to_secs "$elapsed")
    [ -z "$secs" ] && { echo "$(date '+%Y-%m-%d %H:%M:%S') [frequent] etime_to_secs 解析失败 elapsed=$elapsed pid=$pid，保守跳过"; secs=0; }
    [ "$secs" -lt "$threshold" ] && return

    # cecelia 常驻服务豁免（同 kill_if_orphan）
    local cmd
    cmd=$(ps -o command= -p "$pid" 2>/dev/null)
    case "$cmd" in *"/usr/local/libexec/cecelia/"*) return ;; esac

    if is_claude_orphan "$pid" "$tty" "$ppid"; then
      local cwd
      cwd=$(lsof -p "$pid" -a -d cwd -Fn 2>/dev/null | grep '^n' | head -1 | sed 's/^n//')

      kill "$pid" 2>/dev/null
      sleep 1
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
      # kill 后复查
      sleep 1
      if kill -0 "$pid" 2>/dev/null; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') [frequent] kill-failed claude pid=$pid 仍存活（疑似权限不足），不计数"
        return
      fi
      KILLED=$((KILLED + 1))
      echo "$(date '+%Y-%m-%d %H:%M:%S') [frequent] killed claude orphan pid=$pid tty=$tty ppid=$ppid (${secs}s)"

      notify_brain_orphan_killed "$pid" "$cwd"
    fi
  }

  # ── 扫描 vitest/jest 孤儿 ─────────────────────────
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    PID=$(echo "$line" | awk '{print $2}')
    kill_if_orphan "$PID" "$ACTIVE_THRESHOLD"
  done < <(ps aux | grep -E "node.*vitest|node.*jest" | grep -v grep)

  # ── 扫描普通 node 孤儿（排除服务进程）──────────────
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    PID=$(echo "$line" | awk '{print $2}')
    kill_if_orphan "$PID" "$ACTIVE_THRESHOLD"
  done < <(ps aux | grep "node" | grep -v grep | grep -v "brain\|server\|n8n\|vscode\|bridge")

  # ── 扫描 claude 孤儿（v4.0 新逻辑）─────────────────
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    PID=$(echo "$line" | awk '{print $2}')
    TTY=$(echo "$line" | awk '{print $7}')
    PROC_PPID=$(ps -o ppid= -p "$PID" 2>/dev/null | tr -d ' ')
    [ -z "$PROC_PPID" ] && continue
    kill_if_claude_orphan "$PID" "$TTY" "$PROC_PPID" "$ACTIVE_THRESHOLD"
  done < <(ps aux | grep -E " claude$| claude " | grep -v grep)

  if [ "$KILLED" -gt 0 ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [frequent] 清理完成：killed $KILLED 个孤儿进程（内存 ${MEM_PCT}%，CPU ${CPU_PCT}%）"
  fi

  # ── audiomxd 蓝牙路由死循环兜底 v2 ────────────────────────────────────────
  AUDIOMXD_CPU_THRESHOLD=80
  for audiomxd_pid in $(pgrep -x audiomxd 2>/dev/null); do
    audiomxd_cpu=$(ps -o %cpu= -p "$audiomxd_pid" 2>/dev/null | tr -d ' ' | cut -d. -f1)
    if [ -n "$audiomxd_cpu" ] && [ "$audiomxd_cpu" -ge "$AUDIOMXD_CPU_THRESHOLD" ] 2>/dev/null; then
      audiomxd_nice=$(ps -o nice= -p "$audiomxd_pid" 2>/dev/null | tr -d ' ')
      if [ "$audiomxd_nice" != "20" ]; then
        if sudo -n /usr/sbin/taskpolicy -b -p "$audiomxd_pid" 2>/dev/null && \
           sudo -n /usr/bin/renice 20 -p "$audiomxd_pid" >/dev/null 2>&1; then
          echo "$(date '+%Y-%m-%d %H:%M:%S') [frequent] jailed audiomxd pid=${audiomxd_pid}（CPU ${audiomxd_cpu}%，已钉死E核后台nice20，蓝牙路由死循环兜底v2）"
        fi
      fi
    fi
  done

  # 已退出的 harness relay 容器每轮顺手清一次（留 1h 尸检窗口）
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    relay_prune_out=$(docker container prune -f --filter "until=1h" 2>/dev/null || true)
    relay_reclaimed=$(echo "$relay_prune_out" | grep "Total reclaimed space" | awk -F': ' '{print $2}')
    [ -n "$relay_reclaimed" ] && [ "$relay_reclaimed" != "0B" ] && \
      echo "$(date '+%Y-%m-%d %H:%M:%S') [frequent] 已退出容器 prune 回收 ${relay_reclaimed}"
  fi
  exit 0
fi

# ─────────────────────────────────────────────
# daily 模式：磁盘清理
# ─────────────────────────────────────────────
LOG_FILE="/tmp/janitor-$(date +%Y%m%d).log"
# BEFORE 用于计算释放空间（非 macOS 时可能 df 无 /System/Volumes/Data，容错）
BEFORE=$(df "$DISK_VOL" 2>/dev/null | tail -1 | awk '{print $3}' || echo "0")

log() { echo "${DRY_TAG}[$(date '+%H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

log "=== Janitor v5.0 开始清扫 $(date '+%Y-%m-%d')$(${DRY_RUN} && echo ' [DRY-RUN]') ==="

# ── 步骤辅助：记录步骤 FAIL ───────────────────────────────────────────────
# 当某步骤 N>0 但 M=0 时调用此函数
step_fail() {
  local step_num="$1" msg="$2"
  log "  [FAIL] 步骤${step_num}: $msg"
  FAILED_STEPS="${FAILED_STEPS}步骤${step_num} "
}

# 1. Brain/Bridge LaunchDaemon 日志截断（>10M 保留最后 1000 行）
log "[1/$TOTAL_STEPS] Brain/Bridge 服务日志..."
LOGS_DIR="$CECELIA_REPO/logs"
truncated=0
if ! $DRY_RUN; then
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
fi
log "  ✓ 截断 $truncated 个日志"

# 2. /tmp/cecelia-*.log 旧运行日志（>3天删除）
log "[2/$TOTAL_STEPS] Cecelia 旧运行日志..."
if ! $DRY_RUN; then
  deleted=$(find /tmp -maxdepth 1 -name "cecelia-*.log" -mtime +3 -delete -print 2>/dev/null | wc -l | tr -d ' ')
  deleted2=$(find /tmp -maxdepth 1 \( -name "cecelia-err.*" -o -name "cecelia-out.*" \) -mtime +1 -delete -print 2>/dev/null | wc -l | tr -d ' ')
else
  deleted=$(find /tmp -maxdepth 1 -name "cecelia-*.log" -mtime +3 -print 2>/dev/null | wc -l | tr -d ' ')
  deleted2=0
fi
log "  ✓ 检测 $((deleted + deleted2)) 个日志 / 清理 $((DRY_RUN && echo 0 || echo $((deleted + deleted2))))"

# 3. Claude JSONL 会话记录（>7天删除）
log "[3/$TOTAL_STEPS] Claude 会话记录..."
jsonl_detected=0
jsonl_deleted=0
for account_dir in "$HOME"/.claude-account*/projects/ "$HOME"/.claude/projects/; do
  if [ -d "$account_dir" ]; then
    count=$(find "$account_dir" -name "*.jsonl" -mtime +7 -print 2>/dev/null | wc -l | tr -d ' ')
    jsonl_detected=$((jsonl_detected + count))
    if ! $DRY_RUN; then
      find "$account_dir" -name "*.jsonl" -mtime +7 -delete 2>/dev/null || true
      jsonl_deleted=$((jsonl_deleted + count))
    fi
  fi
done
log "  ✓ 检测 $jsonl_detected 个 JSONL 文件 / 清理 $jsonl_deleted 个"

# 4. npm cache 清理
log "[4/$TOTAL_STEPS] npm cache..."
if command -v npm >/dev/null 2>&1; then
  if ! $DRY_RUN; then
    npm cache clean --force 2>/dev/null && log "  ✓ npm cache 已清理" || log "  ✗ 跳过"
  else
    log "  ✓ [dry-run] 跳过 npm cache 清理"
  fi
else
  log "  ✗ 跳过（npm 不存在）"
fi

# 5. Homebrew cache 清理（>7天）
log "[5/$TOTAL_STEPS] Homebrew cache..."
if command -v brew >/dev/null 2>&1; then
  if ! $DRY_RUN; then
    brew cleanup --prune=7 2>/dev/null && log "  ✓ brew cache 已清理" || log "  ✗ 跳过"
  else
    log "  ✓ [dry-run] 跳过 brew cache 清理"
  fi
else
  log "  ✗ 跳过（brew 不存在）"
fi

# 6. /tmp 旧随机临时目录（>1天）
log "[6/$TOTAL_STEPS] /tmp 旧临时目录..."
if ! $DRY_RUN; then
  find /tmp -maxdepth 1 -type d -mtime +1 \
    ! -name "snap-private-tmp" ! -name "systemd-private-*" \
    ! -name "cecelia*" ! -name "claude*" ! -name "vscode*" \
    ! -name "puppeteer*" ! -name "playwright*" ! -name "zenithjoy*" \
    ! -name "tsx-*" ! -name "node_modules" ! -name "tmp" ! -name "." \
    2>/dev/null -exec rm -rf {} + 2>/dev/null || true
fi
log "  ✓ 清理完"

# 7. .prd/.dod/.dev-mode 残留文件（>3天删除）
log "[7/$TOTAL_STEPS] 开发残留文件..."
residual=0
if [ -d "$CECELIA_REPO" ]; then
  for pattern in ".prd-*" ".dod-*" ".dev-mode*" ".dev-incident-log*" ".dev-feedback-report*"; do
    if ! $DRY_RUN; then
      count=$(find "$CECELIA_REPO" -maxdepth 1 -name "$pattern" -mtime +3 -delete -print 2>/dev/null | wc -l | tr -d ' ')
    else
      count=$(find "$CECELIA_REPO" -maxdepth 1 -name "$pattern" -mtime +3 -print 2>/dev/null | wc -l | tr -d ' ')
    fi
    residual=$((residual + count))
  done
fi
log "  ✓ 删除 $residual 个残留文件"

# 8. Git 孤儿分支清理（内联实现，外部 gc 脚本调用已移除）
log "[8/$TOTAL_STEPS] Git 孤儿分支..."
branch_detected=0
branch_cleaned=0
if [ -d "$CECELIA_REPO/.git" ]; then
  cd "$CECELIA_REPO" || true
  # 获取已注册的 worktree 引用（任何分支在 worktree 中就不删）
  wt_refs=$(git worktree list --porcelain 2>/dev/null | grep '^branch ' | awk '{print $2}' | sed 's|refs/heads/||')

  # 扫描 cp-* / worktree-* / feature/* 分支，三条件：已合并到 main + 无 open PR + 无 worktree 引用
  while IFS= read -r branch; do
    [ -z "$branch" ] && continue
    branch="${branch#  }"  # 去除前缀空格

    # 条件1: 已合并到 main
    if ! git branch --merged main 2>/dev/null | grep -qF "$branch"; then
      continue
    fi

    # 条件2: 无 open PR
    open_pr=$(gh pr list --head "$branch" --state open --json number -q '.[0].number' 2>/dev/null || echo "")
    if [ -n "$open_pr" ]; then
      continue
    fi

    # 条件3: 不被任何 worktree 引用
    if echo "$wt_refs" | grep -qxF "$branch"; then
      continue
    fi

    branch_detected=$((branch_detected + 1))
    if ! $DRY_RUN; then
      if git branch -d "$branch" 2>/dev/null; then
        branch_cleaned=$((branch_cleaned + 1))
        log "  ↳ 删除分支: $branch"
      else
        log "  ↳ 无法删除分支: $branch（跳过）"
      fi
    fi
  done < <(git branch 2>/dev/null | grep -E "cp-|worktree-|feature/" | grep -v "^\*")

  # dry-run 下清理数为 0
  if $DRY_RUN; then
    log "  [dry-run] 检测 $branch_detected / 清理 0 个孤儿分支"
  else
    log "  检测 $branch_detected / 清理 $branch_cleaned 个孤儿分支"
    # FAIL 判断：N>0 但 M=0
    if [ "$branch_detected" -gt 0 ] && [ "$branch_cleaned" -eq 0 ]; then
      step_fail "8" "检测 ${branch_detected} 个孤儿分支但清理 0 个"
    fi
  fi
else
  log "  ✗ 跳过（git 仓库不存在）"
fi

# 9. 残留 worktree 清理（扫描 ~/worktrees/{cecelia,zenithjoy}，Guard A 三查）
log "[9/$TOTAL_STEPS] 残留 worktree..."
wt_detected=0
wt_cleaned=0

for scan_dir in "$HOME/worktrees/cecelia" "$HOME/worktrees/zenithjoy"; do
  [ -d "$scan_dir" ] || continue

  for wt_path in "$scan_dir"/*/; do
    [ -d "$wt_path" ] || continue
    wt_path="${wt_path%/}"  # 去除尾部斜杠

    # 判断 mtime > 24h
    wt_mtime=$(stat -c %Y "$wt_path" 2>/dev/null || stat -f %m "$wt_path" 2>/dev/null || echo "0")
    now=$(date +%s)
    age_secs=$(( now - wt_mtime ))
    if [ "$age_secs" -lt 86400 ]; then
      continue  # 未满 24h，跳过
    fi

    # ── Guard A 三查：任一条件满足 → 保护，不删 ──────────
    # Guard A-1: git worktree list 在册
    if git -C "$wt_path" worktree list --porcelain 2>/dev/null | grep -q "worktree $wt_path"; then
      continue  # 已注册，PROTECTED
    fi
    # 也检查宿主仓库是否注册了此路径
    if git worktree list --porcelain 2>/dev/null | grep -q "worktree $wt_path"; then
      continue  # 已注册，PROTECTED
    fi

    # Guard A-2: 目录有未提交改动
    if git -C "$wt_path" status --short 2>/dev/null | grep -q .; then
      continue  # 有改动，PROTECTED
    fi

    # Guard A-3: 含 .dev-lock* 文件
    if find "$wt_path" -maxdepth 1 -name ".dev-lock*" 2>/dev/null | grep -q .; then
      continue  # 有 .dev-lock，PROTECTED
    fi

    # 无 open PR 检查
    wt_branch=$(git -C "$wt_path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    if [ -n "$wt_branch" ] && [ "$wt_branch" != "HEAD" ]; then
      pr_count=$(gh pr list --head "$wt_branch" --state open --json number -q '.[0].number' 2>/dev/null || echo "")
      if [ -n "$pr_count" ]; then
        continue  # 有 open PR，PROTECTED
      fi
    fi

    wt_detected=$((wt_detected + 1))
    if ! $DRY_RUN; then
      if rm -rf "$wt_path" 2>/dev/null; then
        wt_cleaned=$((wt_cleaned + 1))
        log "  ↳ 删除孤儿 worktree: $wt_path"
      else
        log "  ↳ 无法删除: $wt_path（跳过）"
      fi
    fi
  done
done

if $DRY_RUN; then
  log "  [dry-run] 检测 $wt_detected / 清理 0 个孤儿 worktree"
else
  log "  检测 $wt_detected / 清理 $wt_cleaned 个孤儿 worktree"
  # FAIL 判断：N>0 但 M=0
  if [ "$wt_detected" -gt 0 ] && [ "$wt_cleaned" -eq 0 ]; then
    step_fail "9" "检测 ${wt_detected} 个孤儿 worktree 但清理 0 个"
  fi
fi

# 10. Docker 容器/镜像清理
log "[10/$TOTAL_STEPS] Docker 容器/镜像清理..."
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if ! $DRY_RUN; then
    prune_out=$(docker container prune -f --filter "until=1h" 2>/dev/null || true)
    reclaimed=$(echo "$prune_out" | grep "Total reclaimed space" | awk -F': ' '{print $2}')
    [ -z "$reclaimed" ] && reclaimed="0B"

    in_use_ids=$(docker ps -aq 2>/dev/null | xargs -I{} docker inspect --format '{{.Image}}' {} 2>/dev/null | sed 's/sha256://' | cut -c1-12 | sort -u)

    img_deleted=0
    for tag in $(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep '^cecelia-brain:'); do
      case "$tag" in
        cecelia-brain:latest|cecelia-brain:blue-fallback) continue ;;
      esac
      img_id=$(docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' 2>/dev/null | awk -v t="$tag" '$1==t{print $2}')
      [ -z "$img_id" ] && continue
      if echo "$in_use_ids" | grep -q "^${img_id}$"; then
        continue
      fi
      if docker rmi "$tag" >/dev/null 2>&1; then
        img_deleted=$((img_deleted + 1))
      fi
    done
    log "  ✓ container prune 回收 ${reclaimed} | 删除 $img_deleted 个未引用旧版 cecelia-brain 镜像"
  else
    log "  ✓ [dry-run] 跳过 Docker 清理"
  fi
else
  log "  ✗ 跳过（docker 不可用）"
fi

# ── 结果计算 ──────────────────────────────────────────────────────────────
AFTER=$(df "$DISK_VOL" 2>/dev/null | tail -1 | awk '{print $3}' || echo "0")
FREED_MB=$(( (BEFORE - AFTER) / 1024 ))
CURRENT=$(df -h "$DISK_VOL" 2>/dev/null | tail -1 | awk '{print $3 "/" $2 " (" $5 ")"}' || echo "N/A")
log ""
log "=== 清扫完成 ==="
log "释放: ${FREED_MB}MB | 当前: $CURRENT"

# ── 磁盘告警：超70%时 POST Brain ──────────────────────────────────────────
# DISK_PCT 允许通过环境变量注入（测试用）
if [ -n "${DISK_PCT:-}" ]; then
  USAGE_PCT="$DISK_PCT"
else
  USAGE_PCT=$(df "$DISK_VOL" 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%' || echo "0")
fi
AVAIL_GB=$(df -g "$DISK_VOL" 2>/dev/null | tail -1 | awk '{print $4}' || df -BG "$DISK_VOL" 2>/dev/null | tail -1 | awk '{print $4}' | tr -d 'G' || echo "0")

if [ "${USAGE_PCT:-0}" -gt 70 ] 2>/dev/null && ! $DRY_RUN; then
  log "⚠️  磁盘 ${USAGE_PCT}%，超警戒线！"
  # description= 必须非空且含磁盘水位数值（PRD BEHAVIOR-04）
  description="磁盘使用率 ${USAGE_PCT}% 超过 70% 警戒线，可用空间约 ${AVAIL_GB}GB，请人工检查并清理大文件。"
  curl -s -X POST "${BRAIN_URL}/api/brain/tasks" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"🚨 磁盘告警 ${USAGE_PCT}%，需人工检查\",\"priority\":\"P0\",\"skill\":\"/janitor\",\"task_type\":\"alert\",\"description\":\"${description}\"}" \
    2>/dev/null || log "  Brain 不可达，告警已本地记录"
fi

# ── 水位台账：~/janitor-ledger.csv 每次追加一行（日志目录可选）────────────────
# mkdir -p ~/logs 备用（若外部有 logs 目录则台账也可放入）
mkdir -p "${HOME}/logs" 2>/dev/null || true
TS=$(date '+%Y-%m-%dT%H:%M:%S')
FAILED_STEPS_TRIM="${FAILED_STEPS:-}"
# 格式: ts,used_pct,avail_gb,orphan_worktrees,stale_images,failed_steps
# 写入 ~/janitor-ledger.csv（与测试注入 HOME 的路径对齐）
echo "${TS},${USAGE_PCT:-0},${AVAIL_GB:-0},${wt_cleaned:-0},0,${FAILED_STEPS_TRIM}" >> "${HOME}/janitor-ledger.csv" 2>/dev/null || true

# ── 最终退出码 ──────────────────────────────────────────────────────────────
if $DRY_RUN; then
  log "=== dry-run 完成，退出 0 ==="
  exit 0
fi

if [ -n "$FAILED_STEPS" ]; then
  log "[FAIL] 以下步骤检测到残留但清理失败：${FAILED_STEPS}"
  exit 1
fi

exit 0
