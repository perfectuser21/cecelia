#!/usr/bin/env bash
# format-duration.sh 单元测试

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/format-duration.sh"

PASS=0
FAIL=0

check() {
    local desc="$1" expected="$2" actual="$3"
    if [[ "$actual" == "$expected" ]]; then
        echo "  ✅ $desc"
        PASS=$((PASS + 1))
    else
        echo "  ❌ $desc: expected='$expected' got='$actual'"
        FAIL=$((FAIL + 1))
    fi
}

echo "=== format_duration_ms 测试 ==="
check "1d1h1m1s"    "1d 1h 1m 1s" "$(format_duration_ms 90061000)"
check "1h0m0s"      "1h 0m 0s"    "$(format_duration_ms 3600000)"
check "1m5s"        "1m 5s"       "$(format_duration_ms 65000)"
check "0.5s"        "0.5s"        "$(format_duration_ms 500)"
check "50ms→0.1s"   "0.1s"        "$(format_duration_ms 50)"
check "1ms→0.1s"    "0.1s"        "$(format_duration_ms 1)"
check "0s"          "0s"          "$(format_duration_ms 0)"
check "1s"          "1s"          "$(format_duration_ms 1000)"
check "59s"         "59s"         "$(format_duration_ms 59000)"
check "invalid→0s" "0s"          "$(format_duration_ms abc)"

echo ""
echo "=== 结果: $PASS 通过 / $FAIL 失败 ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
