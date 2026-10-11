#!/usr/bin/env bash
# 回归测试：部署链 Bark 告警在 Brain 容器内必须真能推出去（e2fc7076 遗留项）。
#
# 根因：Brain 镜像（alpine）只装了 curl/bash 等，没有 jq 也没有 python3。
# scripts/lib/bluegreen.sh 的 _url_encode 两个编码器都不在时原样返回中文+空格，
# send_bark 拼出的 https://api.day.app/<token>/Brain部署/<含空格消息> 被 curl 拒收
# （URL malformed），部署日志只剩"[bark] 推送失败(不阻塞)"。sidecar 的 _sidecar_bark 同一缺陷。
# 本测试把 PATH 收窄到只有假 curl（模拟容器里没有 jq/python3），断言：
#   ① _url_encode 对中文/空格/保留字符做正确百分号编码（纯 bash，不依赖外部编码器）
#   ② send_bark 发出的 URL 不含空格与非 ASCII 字节
#   ③ sidecar 的告警复用同一个纯 bash 编码器，不再依赖 python3
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAIL=0
BASH_BIN="$(command -v bash)"

mkdir -p "$TMP/bin" "$TMP/home/.credentials"
cat > "$TMP/bin/curl" <<CURL
#!${BASH_BIN}
for a in "\$@"; do case "\$a" in https://*) printf '%s\n' "\$a" > "$TMP/curl-url.txt";; esac; done
exit 0
CURL
chmod +x "$TMP/bin/curl"
printf 'BARK_TOKEN=tok123\n' > "$TMP/home/.credentials/bark.env"

# shellcheck disable=SC1091
source "$REPO_ROOT/scripts/lib/bluegreen.sh"

ORIG_PATH="$PATH"
export PATH="$TMP/bin"   # 只剩假 curl：没有 jq / python3，等同 Brain 容器
if command -v jq >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1; then
  export PATH="$ORIG_PATH"; echo "FAIL: 测试环境收窄 PATH 失败"; exit 1
fi

# ── 用例 1：_url_encode 纯 bash 百分号编码 ──
got="$(_url_encode '部署 失败 v1.2_a-b~c/d?e&f')"
want='%E9%83%A8%E7%BD%B2%20%E5%A4%B1%E8%B4%A5%20v1.2_a-b~c%2Fd%3Fe%26f'
if [[ "$got" == "$want" ]]; then
  echo "PASS 1: 无 jq/python3 时 _url_encode 仍正确编码"
else
  echo "FAIL 1: _url_encode 输出 [$got]，期望 [$want]"; FAIL=1
fi

# ── 用例 2：send_bark 发出的 URL 合法（无空格、无非 ASCII 字节）──
HOME="$TMP/home" send_bark "台账 DEPLOYMENT_PENDING 且自动补收账核验未通过" >"$TMP/bark.out" 2>&1
url=""
[[ -f "$TMP/curl-url.txt" ]] && url="$(<"$TMP/curl-url.txt")"
export PATH="$ORIG_PATH"
if [[ -z "$url" ]]; then
  echo "FAIL 2: send_bark 没有调用 curl"; cat "$TMP/bark.out"; FAIL=1
elif LC_ALL=C grep -q '[^ -~]' <<<"$url" || [[ "$url" == *" "* ]]; then
  echo "FAIL 2: Bark URL 含空格或非 ASCII 字节: $url"; FAIL=1
elif [[ "$url" != "https://api.day.app/tok123/Brain%E9%83%A8%E7%BD%B2/"*"DEPLOYMENT_PENDING"* ]]; then
  echo "FAIL 2: Bark URL 结构不对: $url"; FAIL=1
else
  echo "PASS 2: send_bark URL 已编码: $url"
fi

# ── 用例 3：sidecar 告警复用纯 bash 编码器，不依赖 python3 ──
SIDECAR="$REPO_ROOT/scripts/lib/bluegreen-sidecar.sh"
sidecar_bark="$(sed -n '/^_sidecar_bark()/,/^}/p' "$SIDECAR")"
if grep -q 'python3' <<<"$sidecar_bark"; then
  echo "FAIL 3: _sidecar_bark 仍依赖 python3 编码（容器内不存在）"; FAIL=1
elif ! grep -q '_url_encode' <<<"$sidecar_bark" || ! grep -q 'url-encode.sh' "$SIDECAR"; then
  echo "FAIL 3: _sidecar_bark 未复用 scripts/lib/url-encode.sh 的 _url_encode"; FAIL=1
else
  echo "PASS 3: sidecar 告警复用纯 bash 编码器"
fi

exit "$FAIL"
