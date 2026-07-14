#!/usr/bin/env bash
# check-deploy-fingerprint.sh — 部署后双实例指纹校验
#
# 从本机 5211 和 HK（100.86.118.99:5211）各取 index.html，对比 SHA256。
# 一致→绿色 PASS；不一致→红色 FAIL + Bark 推送 → 退出非零。
#
# 环境变量（可覆盖）：
#   LOCAL_FRONTEND_URL   本机前端 URL（默认 http://localhost:5211）
#   HK_FRONTEND_URL      HK 前端 URL（默认 http://100.86.118.99:5211）
#   CECELIA_SKIP_HK 非空则跳过 HK 指纹校验（仅校验本机可达性）
#
# 退出码：0=指纹一致（或 HK 跳过时本机可达）  1=不一致或取指纹失败

set -uo pipefail

LOCAL_URL="${LOCAL_FRONTEND_URL:-http://localhost:5211}"
HK_URL="${HK_FRONTEND_URL:-http://100.86.118.99:5211}"
TIMEOUT=15

_hash() {
    local url="$1"
    local body
    body=$(curl -s --max-time "$TIMEOUT" --fail "$url/" 2>&1) || {
        echo "FETCH_FAIL"
        return
    }
    if command -v sha256sum &>/dev/null; then
        printf '%s' "$body" | sha256sum | awk '{print $1}'
    elif command -v shasum &>/dev/null; then
        printf '%s' "$body" | shasum -a 256 | awk '{print $1}'
    else
        printf '%s' "$body" | md5sum | awk '{print $1}'
    fi
}

_send_bark() {
    local title="$1" body="$2"
    local CREDS="$HOME/.credentials/bark.env"
    [[ -f "$CREDS" ]] && source "$CREDS"
    [[ -z "${BARK_TOKEN:-}" ]] && return
    local BASE="${BARK_API_URL:-https://api.day.app/$BARK_TOKEN}"
    local T B
    T=$(printf '%s' "$title" | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read().strip()))' 2>/dev/null || echo "Cecelia")
    B=$(printf '%s' "$body"  | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read().strip()))' 2>/dev/null || echo "fingerprint-mismatch")
    curl -s -o /dev/null --max-time 10 "${BASE%/}/${T}/${B}?group=Cecelia&level=timeSensitive" || true
}

echo "=== 部署后指纹校验 ==="

LOCAL_HASH=$(_hash "$LOCAL_URL")
echo "  本机 5211 hash: $LOCAL_HASH"

if [[ "$LOCAL_HASH" == "FETCH_FAIL" ]]; then
    echo "❌ 无法取到本机 5211 index.html（服务未起？）"
    exit 1
fi

if [[ -n "${CECELIA_SKIP_HK:-}" ]]; then
    echo "  CECELIA_SKIP_HK 已设，跳过 HK 指纹对比"
    echo "✅ 指纹校验：本机 PASS（hash=${LOCAL_HASH:0:12}…）"
    exit 0
fi

HK_HASH=$(_hash "$HK_URL")
echo "  HK    5211 hash: $HK_HASH"

if [[ "$HK_HASH" == "FETCH_FAIL" ]]; then
    MSG="HK 5211 index.html 取不到（Tailscale 断链？HK 服务未起？）local=${LOCAL_HASH:0:12}"
    echo "⚠️  $MSG"
    _send_bark "Cecelia 指纹校验 ⚠️" "$MSG"
    echo "  → 本机已上线，HK 连不到，请手动检查 HK 服务"
    exit 1
fi

if [[ "$LOCAL_HASH" == "$HK_HASH" ]]; then
    echo "✅ 指纹一致：本机 5211 = HK 5211（hash=${LOCAL_HASH:0:12}…）"
    exit 0
else
    MSG="dashboard 指纹不一致！local=${LOCAL_HASH:0:12} HK=${HK_HASH:0:12}——HK 可能未同步"
    echo "❌ $MSG"
    _send_bark "Cecelia 指纹 MISMATCH 🔴" "$MSG"
    exit 1
fi
