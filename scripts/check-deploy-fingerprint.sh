#!/usr/bin/env bash
# check-deploy-fingerprint.sh — 部署后本机产物指纹校验
#
# 优先路径：取本机 /build-info.json 的 git_sha 对账（vite 产物烙印，语义化、可读）；
#   可选 EXPECTED_GIT_SHA（promote 从新产物 build-info.json 读出后经 env 传入）——
#   本机在服 sha ≠ 期望 sha 直接红（分家/陈旧 inode 病因二选一）。
# 回退路径：build-info 取不到/非 JSON（旧产物/SPA fallback）→ 退回本机 index.html 可达性校验。
# 本机身份符合期望→绿色 PASS；不符合→红色 FAIL + Bark 推送 → 退出非零。
#
# 环境变量（可覆盖）：
#   LOCAL_FRONTEND_URL   本机前端 URL（默认 http://localhost:5211）
#
# 退出码：0=本机身份符合期望（旧产物仅校验可达性）  1=身份不符或不可达

set -uo pipefail

LOCAL_URL="${LOCAL_FRONTEND_URL:-http://localhost:5211}"
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
# git_sha=unknown（构建时没注入 GIT_SHA）也归 PARSE_FAIL：与 deploy-local 判变端"unknown=拿不到"
# 语义对齐，防止 unknown==unknown 产物身份对账假绿。
_get_sha() {
    local url="$1" body sha
    body=$(curl -s --max-time "$TIMEOUT" "$url/build-info.json" 2>/dev/null) || { echo "FETCH_FAIL"; return; }
    [[ -z "$body" ]] && { echo "FETCH_FAIL"; return; }
    sha=$(printf '%s' "$body" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(j.git_sha||'PARSE_FAIL')}catch{process.stdout.write('PARSE_FAIL')}})" 2>/dev/null || echo "PARSE_FAIL")
    [[ "$sha" == "unknown" ]] && sha="PARSE_FAIL"
    echo "$sha"
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
    echo "✅ sha 对账：本机 PASS（${LOCAL_SHA:0:12}…）"
    exit 0
else
    if [[ -n "${EXPECTED_GIT_SHA:-}" ]]; then
        echo "❌ 本机无法读取构建 SHA，不能验证期望产物 ${EXPECTED_GIT_SHA}"
        exit 1
    fi
    echo "  ⚠️ build-info sha 不可用（旧产物/服务异常，本机=${LOCAL_SHA}），未指定期望 SHA，仅校验本机 index 可达性"
fi

# ── 回退路径：本机 index.html 可达性 ─────────────────────────────────────────────
LOCAL_HASH=$(_hash "$LOCAL_URL")
echo "  本机 5211 hash: $LOCAL_HASH"

if [[ "$LOCAL_HASH" == "FETCH_FAIL" ]]; then
    echo "❌ 无法取到本机 5211 index.html（服务未起？）"
    exit 1
fi

echo "✅ 本机产物可达（hash=${LOCAL_HASH:0:12}…）"
exit 0
