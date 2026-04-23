#!/usr/bin/env bash
# 真机 E2E — GET /api/brain/time（SC-003）
# 对应 tests/ws1/time.test.ts 的 it(2)(4)(6) 三条核心断言：
#   it(2) response body contains exactly the three keys iso, timezone, unix — no others
#   it(4) unix is a positive integer in seconds (at most 10 digits), not milliseconds
#   it(6) new Date(iso).getTime() and unix * 1000 agree within 2000ms
#
# 设计约束（Reviewer Round 1 Risk 5）：
#   - 不得只跑 `jq -e '.iso and .timezone'` 这种弱断言（会假阳性）
#   - 必须覆盖字段白名单 (Object.keys 等价)、unix 类型 (type == "number")、
#     长度 (length <= 10)、iso↔unix 差值 (差 <= 2000ms)
#
# 依赖: bash, curl, jq
# 用法: BRAIN_URL=http://localhost:5221 bash tests/e2e/brain-time.sh
# 退出码: 0 = 全部通过，非 0 = 第一个失败的步骤编号

set -u

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
ENDPOINT="${BRAIN_URL}/api/brain/time"

echo "[e2e] GET ${ENDPOINT}"

# ---- step 0: HTTP 状态 + JSON content-type ----
HDR_FILE="$(mktemp)"
BODY_FILE="$(mktemp)"
trap 'rm -f "$HDR_FILE" "$BODY_FILE"' EXIT

HTTP_CODE=$(curl -sS -D "$HDR_FILE" -o "$BODY_FILE" -w '%{http_code}' "$ENDPOINT" || echo 000)
if [ "$HTTP_CODE" != "200" ]; then
  echo "[FAIL 0] expected HTTP 200, got ${HTTP_CODE}"
  exit 10
fi
if ! grep -qi 'content-type:.*application/json' "$HDR_FILE"; then
  echo "[FAIL 0] content-type not application/json"
  exit 11
fi

# ---- step 1: 字段白名单（等价于 Object.keys(body).sort() === ['iso','timezone','unix']） ----
# Object.keys equivalent in jq: (. | keys | sort) == ["iso","timezone","unix"]
if ! jq -e '(. | keys | sort) == ["iso","timezone","unix"]' "$BODY_FILE" >/dev/null; then
  echo "[FAIL 1] body keys are not exactly [iso, timezone, unix] (Object.keys whitelist breach)"
  echo "--- body ---"
  cat "$BODY_FILE"
  exit 1
fi

# ---- step 2: unix 必须是 number 类型（type=="number"） ----
# 关键断言：.unix | type == "number"（Risk 1 Reviewer 指出的关键 grep 表达式之一）
if ! jq -e '.unix | type == "number"' "$BODY_FILE" >/dev/null; then
  echo "[FAIL 2] .unix type is not number"
  exit 2
fi

# ---- step 3: unix 必须是整数秒，长度 <= 10（避免实现返回毫秒） ----
# 关键表达式：length <= 10（秒级时间戳 10 位数到 2286 年才溢出）
if ! jq -e '(.unix | floor) == .unix' "$BODY_FILE" >/dev/null; then
  echo "[FAIL 3] .unix is not an integer"
  exit 3
fi
if ! jq -e '(.unix | tostring | length) <= 10' "$BODY_FILE" >/dev/null; then
  echo "[FAIL 3] .unix tostring length > 10 — looks like milliseconds"
  exit 3
fi

# ---- step 4: iso 严格 ISO 8601 格式（含 Z 或 ±HH:MM 后缀） ----
# 正则：^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$
if ! jq -e '.iso | test("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:?\\d{2})$")' "$BODY_FILE" >/dev/null; then
  echo "[FAIL 4] .iso does not match strict ISO 8601 instant format"
  exit 4
fi

# ---- step 5: iso 解析秒 与 .unix 差值 <= 2 秒（2000ms 级一致性） ----
# 关键表达式：(iso - unix) <= 2  ←对应 tests/ws1/time.test.ts it(6) 的 2000ms 阈值
if ! jq -e '((.iso | fromdateiso8601) - .unix | if . < 0 then -. else . end) <= 2' "$BODY_FILE" >/dev/null; then
  echo "[FAIL 5] iso and unix diverge by more than 2000ms (2 seconds)"
  cat "$BODY_FILE"
  exit 5
fi

# ---- step 6: timezone 非空字符串 ----
if ! jq -e '(.timezone | type == "string") and (.timezone | length > 0)' "$BODY_FILE" >/dev/null; then
  echo "[FAIL 6] .timezone missing or empty"
  exit 6
fi

# ---- step 7: query 污染不生效（发 ?iso=evil&unix=1&timezone=Fake/Zone，服务器必须忽略） ----
POISON_BODY="$(curl -sS "${ENDPOINT}?iso=evil&unix=1&timezone=Fake%2FZone")"
echo "$POISON_BODY" > "$BODY_FILE"
if jq -e '.iso == "evil" or .unix == 1 or .timezone == "Fake/Zone"' "$BODY_FILE" >/dev/null; then
  echo "[FAIL 7] server payload was poisoned by query parameters"
  exit 7
fi

echo "[e2e] PASS — all 7 assertions met"
exit 0
