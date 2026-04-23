#!/usr/bin/env bash
# 真机 E2E — GET /api/brain/time（SC-003）
# 对应 tests/ws1/time.test.ts 的核心 BEHAVIOR 断言（Round 4）：
#   - 字段白名单 / unix 类型与位数 / iso 严格 ISO 8601 UTC Z / iso↔unix 一致性
#   - timezone 非空 / query 污染免疫 / 非 GET 方法不泄漏 / body 污染免疫
#
# Round 3 立场（Reviewer Round 2 问题 1&2）：
#   - iso 锁死为 UTC Z 后缀（不允许 ±HH:MM 本地偏移），timezone 字段独立反映服务器元信息
#   - 非 GET 方法 (POST/PUT/PATCH/DELETE) 不得返回 200 且不得泄漏 iso/timezone/unix
#   - POST body {iso,unix,timezone} 不污染响应（handler 根本不执行）
#
# Round 4 立场（Reviewer Round 3 问题 3）：
#   - step 8 状态码收紧为硬枚举 {404, 405}（不再是「非 200」软阈值），便于机械判定
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
# 关键断言：.unix | type == "number"
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

# ---- step 4: iso 严格 ISO 8601 UTC 格式（Round 3 立场：仅 Z 后缀，不接受 ±HH:MM） ----
# 正则：^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$
if ! jq -e '.iso | test("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$")' "$BODY_FILE" >/dev/null; then
  echo "[FAIL 4] .iso does not match strict ISO 8601 UTC (Z-suffix only) format"
  echo "--- body ---"
  cat "$BODY_FILE"
  exit 4
fi
# 反向兜底：明确拒绝 ±HH:MM 形式（若实现返回带偏移的 ISO 也必须 fail）
if jq -e '.iso | test("[+-]\\d{2}:?\\d{2}$")' "$BODY_FILE" >/dev/null; then
  echo "[FAIL 4] .iso contains ±HH:MM offset; Round 3 requires UTC Z-suffix only"
  exit 4
fi

# ---- step 5: iso 解析秒 与 .unix 差值 <= 2 秒（2000ms 级一致性） ----
# 关键表达式：(iso - unix) <= 2  ← 对应 tests/ws1/time.test.ts "iso↔unix 一致性" 的 2000ms 阈值
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

# ---- step 8: 非 GET 方法 + body 污染免疫（Round 3 新增 — Reviewer Round 2 问题 2；Round 4 状态码硬枚举 — Reviewer Round 3 问题 3） ----
# 约束：POST/PUT/PATCH/DELETE 到 /api/brain/time：
#   - 状态码必须 ∈ {404, 405}（Round 4 收紧，不再是「非 200」软阈值）
#   - 响应体不得出现 iso/timezone/unix key
#   - 即便 POST body 注入 {iso:"evil",unix:1,timezone:"Fake/Zone"} 也不得回显 "evil"/"Fake/Zone" 字面量
for METHOD in POST PUT PATCH DELETE; do
  METHOD_BODY_FILE="$(mktemp)"
  METHOD_CODE=$(curl -sS -X "$METHOD" \
    -H 'Content-Type: application/json' \
    -d '{"iso":"evil","unix":1,"timezone":"Fake/Zone"}' \
    -o "$METHOD_BODY_FILE" -w '%{http_code}' "$ENDPOINT" || echo 000)
  # Round 4 硬枚举：{404, 405}
  if [ "$METHOD_CODE" != "404" ] && [ "$METHOD_CODE" != "405" ]; then
    echo "[FAIL 8] ${METHOD} ${ENDPOINT} returned HTTP ${METHOD_CODE}; Round 4 requires status in {404, 405}"
    cat "$METHOD_BODY_FILE"
    rm -f "$METHOD_BODY_FILE"
    exit 8
  fi
  # 响应正文不得回显 body 注入值
  if grep -Eq '"(iso|unix|timezone)"[[:space:]]*:' "$METHOD_BODY_FILE"; then
    # 若响应恰好是结构化 JSON 错误体（例如框架 404 JSON），校验三字段 key 均不存在
    if jq -e 'has("iso") or has("unix") or has("timezone")' "$METHOD_BODY_FILE" >/dev/null 2>&1; then
      echo "[FAIL 8] ${METHOD} response leaks iso/unix/timezone keys — body may have been processed"
      cat "$METHOD_BODY_FILE"
      rm -f "$METHOD_BODY_FILE"
      exit 8
    fi
  fi
  if grep -qE '\bevil\b|Fake/Zone' "$METHOD_BODY_FILE"; then
    echo "[FAIL 8] ${METHOD} response echoed injected body values (evil / Fake/Zone) — body pollution"
    cat "$METHOD_BODY_FILE"
    rm -f "$METHOD_BODY_FILE"
    exit 8
  fi
  rm -f "$METHOD_BODY_FILE"
done

echo "[e2e] PASS — all 8 assertions met"
exit 0
