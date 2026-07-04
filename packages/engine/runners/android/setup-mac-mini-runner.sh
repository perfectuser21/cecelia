#!/bin/bash
# setup-mac-mini-runner.sh — 在 Mac mini 上注册 Android self-hosted runner
#
# 前提条件：
#   1. Mac mini 已接入 Tailscale（ts up）
#   2. Honor 测试机已开启 ADB over TCP（adb tcpip 5555）
#   3. 从 Tailscale 控制台确认 Honor 机器的 Tailscale IP（写入 GitHub Secret: HONOR_DEVICE_ADB_TARGET）
#   4. 已安装 Android Platform Tools（含 adb）
#   5. 已有 GitHub PAT（repo scope + admin:org/repo 的 self-hosted runner 权限）
#
# 用法：
#   GITHUB_REPO="org/repo" RUNNER_TOKEN="<token>" bash setup-mac-mini-runner.sh
#
# Token 获取：
#   https://github.com/<org>/<repo>/settings/actions/runners/new?runnerOs=osx
set -euo pipefail

REPO="${GITHUB_REPO:?需要设置 GITHUB_REPO=org/repo}"
TOKEN="${RUNNER_TOKEN:?需要设置 RUNNER_TOKEN}"
RUNNER_NAME="${RUNNER_NAME:-mac-mini-android-runner}"
RUNNER_LABELS="self-hosted,mac-mini,android"
RUNNER_DIR="$HOME/actions-runner"
RUNNER_VERSION="2.322.0"   # 更新时与 https://github.com/actions/runner/releases 对齐

log() { echo "[setup] $*"; }

# ── 1. 检查依赖 ────────────────────────────────────────────────────────────────
log "检查 adb ..."
adb version || { log "❌ 未找到 adb，请先安装 Android Platform Tools"; exit 1; }

log "检查 Tailscale ..."
tailscale status --self | head -1 || { log "❌ Tailscale 未连接"; exit 1; }

# ── 2. 下载 GitHub Actions Runner ──────────────────────────────────────────────
mkdir -p "$RUNNER_DIR" && cd "$RUNNER_DIR"

ARCH="osx-arm64"
uname -m | grep -q "x86_64" && ARCH="osx-x64"

TARBALL="actions-runner-${ARCH}-${RUNNER_VERSION}.tar.gz"
if [ ! -f "$TARBALL" ]; then
  log "下载 runner $RUNNER_VERSION ($ARCH) ..."
  curl -fsSL -o "$TARBALL" \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${TARBALL}"
  tar xzf "$TARBALL"
fi

# ── 3. 配置 runner ────────────────────────────────────────────────────────────
log "配置 runner: name=$RUNNER_NAME labels=$RUNNER_LABELS"
./config.sh \
  --url "https://github.com/$REPO" \
  --token "$TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "$RUNNER_LABELS" \
  --work "_work" \
  --unattended \
  --replace

# ── 4. 安装为 launchd 服务（macOS 开机自启）────────────────────────────────────
log "安装 launchd 服务 ..."
sudo ./svc.sh install
sudo ./svc.sh start
sudo ./svc.sh status

log ""
log "✅ Runner 已注册并启动"
log "   名称: $RUNNER_NAME"
log "   标签: $RUNNER_LABELS"
log "   工作目录: $RUNNER_DIR/_work"
log ""
log "接下来："
log "  1. 在 GitHub repo Settings → Actions → Runners 确认 runner 上线"
log "  2. 把 Honor 设备 Tailscale IP 写入 GitHub Secret: HONOR_DEVICE_ADB_TARGET"
log "     格式: <tailscale-ip>:5555  （例: 100.72.10.5:5555）"
log "  3. 在手机端持续保持 adb tcpip 5555（重启后需重新执行）"
log "     可用 Tasker / adb 守护脚本确保开机自动开启"
