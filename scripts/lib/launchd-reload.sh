#!/usr/bin/env bash
# launchd-reload.sh — 用户域 LaunchAgent 安全重载（被 source；preview-agent-install.sh 与 preview-host-release.sh 共用）
#
# 为什么需要：launchctl bootout 是异步的——命令返回时服务可能还在卸载中，紧接着 bootstrap
# 会报 "Bootstrap failed: 5: Input/output error"。2026-10-12 MMV 跑 preview-host-release.sh --apply
# 实测因此整次发布回滚（回滚时的重载因时间差更长反而成功）。
#
# 做法：bootout → 轮询 launchctl print 直到服务消失（最多 PREVIEW_LAUNCHD_WAIT_SECS 秒）
#       → bootstrap，失败则 sleep、再 bootout+等卸载后重试（共 PREVIEW_LAUNCHD_BOOTSTRAP_TRIES 次）
#       → kickstart -k。
# 环境（测试可调小）：
#   PREVIEW_LAUNCHD_WAIT_SECS        等卸载的上限秒数（默认 15）
#   PREVIEW_LAUNCHD_POLL_INTERVAL    轮询间隔秒（默认 0.5）
#   PREVIEW_LAUNCHD_BOOTSTRAP_TRIES  bootstrap 尝试次数（默认 3）
#   PREVIEW_LAUNCHD_RETRY_SLEEP      bootstrap 失败后的等待秒（默认 2）

# 等 gui/<uid>/<label> 从 launchd 消失；超时返回 1（调用方仍会尝试 bootstrap，由重试兜底）
launchd_wait_gone() {
  local target="$1"
  local interval="${PREVIEW_LAUNCHD_POLL_INTERVAL:-0.5}"
  local tries
  tries=$(awk -v w="${PREVIEW_LAUNCHD_WAIT_SECS:-15}" -v i="$interval" 'BEGIN{n=int(w/i); print (n<1?1:n)}')
  while (( tries-- > 0 )); do
    launchctl print "$target" >/dev/null 2>&1 || return 0
    sleep "$interval"
  done
  echo "[launchd-reload] ⚠️ ${target} 在 ${PREVIEW_LAUNCHD_WAIT_SECS:-15}s 内仍未卸载完" >&2
  return 1
}

# launchd_reload <label> <plist>：bootout → 等卸载 → bootstrap（带重试）→ kickstart -k
launchd_reload() {
  local label="$1" plist="$2"
  local domain target
  domain="gui/$(id -u)"
  target="${domain}/${label}"
  local max="${PREVIEW_LAUNCHD_BOOTSTRAP_TRIES:-3}" attempt=1
  launchctl bootout "$target" 2>/dev/null || true
  launchd_wait_gone "$target" || true
  until launchctl bootstrap "$domain" "$plist"; do
    if (( attempt >= max )); then
      echo "[launchd-reload] ❌ bootstrap ${label} 连续 ${max} 次失败" >&2
      return 1
    fi
    echo "[launchd-reload] bootstrap ${label} 第 ${attempt} 次失败，${PREVIEW_LAUNCHD_RETRY_SLEEP:-2}s 后重试" >&2
    sleep "${PREVIEW_LAUNCHD_RETRY_SLEEP:-2}"
    launchctl bootout "$target" 2>/dev/null || true
    launchd_wait_gone "$target" || true
    attempt=$((attempt + 1))
  done
  launchctl kickstart -k "$target"
}
