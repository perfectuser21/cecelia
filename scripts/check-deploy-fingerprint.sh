#!/usr/bin/env bash
# check-deploy-fingerprint.sh — 部署后双实例指纹校验
#
# 优先路径：取两端 /build-info.json 的 git_sha 对账（vite 产物烙印，语义化、可读）；
#   可选 EXPECTED_GIT_SHA（promote 从新产物 build-info.json 读出后经 env 传入）——
#   本机在服 sha ≠ 期望 sha 直接红（分家/陈旧 inode 病因二选一）。
# 回退路径：build-info 取不到/非 JSON（旧产物/SPA fallback）→ 退回 index.html hash 对比。
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

# 取 build-info.json 的 git_sha；FETCH_FAIL=取不到，PARSE_FAIL=非 JSON（如 SPA fallback 的 HTML）
_get_sha() {
    local url="$1" body
    body=$(curl -s --max-time "$TIMEOUT" "$url/build-info.json" 2>/dev/null) || { echo "FETCH_FAIL"; return; }
    [[ -z "$body" ]] && { echo "FETCH_FAIL"; return; }
    printf '%s' "$body" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(j.git_sha||'PARSE_FAIL')}catch{process.stdout.write('PARSE_FAIL')}})" 2>/dev/null || echo "PARSE_FAIL"
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

# ── 优先路径：build-info.json git_sha 对账 ─────────────────────────────────────
LOCAL_SHA=$(_get_sha "$LOCAL_URL")
if [[ "$LOCAL_SHA" != "FETCH_FAIL" && "$LOCAL_SHA" != "PARSE_FAIL" && -n "$LOCAL_SHA" ]]; then
    echo "  本机 5211 git_sha: $LOCAL_SHA"
    # 期望 sha（promote 从新产物 build-info.json 读出后经 env 传入）
    if [[ -n "${EXPECTED_GIT_SHA:-}" && "$LOCAL_SHA" != "$EXPECTED_GIT_SHA" ]]; then
        MSG="本机在服 sha=${LOCAL_SHA:0:12} ≠ 新产物 sha=${EXPECTED_GIT_SHA:0:12}——病因二选一：①分家（容器挂载目录≠部署根 dist）②inode 陈旧（mv 换目录后容器持旧 inode，重启 cecelia-frontend 后复查）"
        echo "❌ $MSG"
        _send_bark "Cecelia 部署对账 MISMATCH 🔴" "$MSG"
        exit 1
    fi
    if [[ -n "${CECELIA_SKIP_HK:-}" ]]; then
        echo "  CECELIA_SKIP_HK 已设，跳过 HK sha 对比"
        echo "✅ sha 对账：本机 PASS（${LOCAL_SHA:0:12}…）"
        exit 0
    fi
    HK_SHA=$(_get_sha "$HK_URL")
    if [[ "$HK_SHA" != "FETCH_FAIL" && "$HK_SHA" != "PARSE_FAIL" && -n "$HK_SHA" ]]; then
        echo "  HK    5211 git_sha: $HK_SHA"
        if [[ "$LOCAL_SHA" == "$HK_SHA" ]]; then
            echo "✅ sha 对账一致：本机 = HK（${LOCAL_SHA:0:12}…）"
            exit 0
        else
            MSG="dashboard sha 不一致！local=${LOCAL_SHA:0:12} HK=${HK_SHA:0:12}——HK 未同步"
            echo "❌ $MSG"
            _send_bark "Cecelia sha MISMATCH 🔴" "$MSG"
            exit 1
        fi
    fi
    echo "  ⚠️ HK build-info 取不到（${HK_SHA}），退回 index hash 对比"
else
    echo "  ⚠️ build-info sha 不可用（旧产物/服务异常，本机=${LOCAL_SHA}），退回 index hash 对比"
    if [[ -n "${EXPECTED_GIT_SHA:-}" ]]; then
        echo "  ⚠️ 本机取不到 build-info（可能在服老产物 = 分家/容器 inode 陈旧——重启 cecelia-frontend 后复查），期望 sha 检查退化为 index hash 对比"
    fi
fi

# ── 回退路径：index.html hash 对比 ─────────────────────────────────────────────
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
