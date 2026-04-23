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
# Round 5 立场（Reviewer Round 4 Risk 3）：
#   - 曾尝试「状态码相对化到 baseline」的方案（baseline = 对未命中路径 $METHOD 的响应码，step 8 要求 == baseline）
#
# Round 6 立场（Reviewer Round 5 Risk 1）：
#   - 相对化到 baseline 过严 —— 同一 Brain 实例中不同合法 middleware 可能对不同路径返回不同状态码
#     （例如 `/api/brain/__nope__` 命中 404，但 `/api/brain/time` 的 POST 被前置 405 method-not-allowed middleware 捕获）。
#     合法实现也可能让 step 8 exit 8。
#   - Round 6 路线：引入「合法未命中响应集合」
#     ACCEPTABLE_NOT_FOUND_STATUS = {401, 403, 404, 405, 415, 422, 429, 500}
#     涵盖 Express 默认 404、methodNotAllowed 405、auth 401/403、媒介协商 415、body 校验 422、限流 429、
#     内部错误 500 —— 所有「不是 200 且不是 000」的真实反模式状态码。
#     - step 7.5：断言 baseline 对 nonexistent 路径发请求 **∈ ACCEPTABLE_NOT_FOUND_STATUS**（sanity 兜底；
#       若 baseline 本身是 200/000，说明 Brain 全局路径行为异常，直接 exit 75）
#     - step 8：断言 POST/PUT/PATCH/DELETE 到 /api/brain/time **∈ ACCEPTABLE_NOT_FOUND_STATUS 且 ≠ 200**，
#       **不要求等于 baseline**（allow any legit NOT_FOUND-ish status）。
#   - 真正的 mutation「POST /time 也返回 200」仍被抓住（200 不在 ACCEPTABLE 集合里），
#     但合法实现走任意未命中分支（404/405/401/...）都不被误杀。
#
# 依赖: bash, curl, jq
# 用法: BRAIN_URL=http://localhost:5221 bash tests/e2e/brain-time.sh
# 退出码: 0 = 全部通过，非 0 = 第一个失败的步骤编号（75 = step 7.5 baseline sanity 失败）

set -u

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
ENDPOINT="${BRAIN_URL}/api/brain/time"

echo "[e2e] GET ${ENDPOINT}"

# Round 6 — 合法的「未命中」响应集合（非 200 且非 000 的兜底状态码集合）
# BASELINE_POST / BASELINE_PUT / BASELINE_PATCH / BASELINE_DELETE / EXPECTED_CODE 仍作为诊断变量保留，
# 但 step 8 只用 ACCEPTABLE_NOT_FOUND_STATUS 做集合判定，不再要求 == baseline
ACCEPTABLE_NOT_FOUND_STATUS="401 403 404 405 415 422 429 500"

is_acceptable_not_found() {
  local code="$1"
  case " $ACCEPTABLE_NOT_FOUND_STATUS " in
    *" $code "*) return 0 ;;
    *) return 1 ;;
  esac
}

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

# ---- step 7.5: sanity baseline（Round 5 引入；Round 6 — Reviewer Round 5 Risk 1 松绑） ----
# 背景：
#   Round 4 硬编码「非 GET 状态码 ∈ {404, 405}」不相对化到 Brain 实际 NotFound 行为。
#   Round 5 相对化到 baseline（step 8 要求 == 同 METHOD 对 nonexistent 路径的响应码）——但
#   Reviewer Round 5 指出同一 Brain 实例中不同合法 middleware 对不同路径的响应码可能不一致，
#   例如 nonexistent 路径命中 Express 默认 404，但 /api/brain/time 上的 POST 被 methodNotAllowed middleware
#   提前 405 —— 合法实现也会让 step 8 exit 8。
#
# Round 6 路线：
#   引入 ACCEPTABLE_NOT_FOUND_STATUS = {401 403 404 405 415 422 429 500}（所有「不是 200 且不是 000」的
#   合法未命中兜底状态码）。step 7.5 断言 baseline ∈ ACCEPTABLE_NOT_FOUND_STATUS，作为「Brain 全局未命中行为
#   健康」的前置检查；step 8 仅要求 /api/brain/time 非 GET 状态 ∈ ACCEPTABLE_NOT_FOUND_STATUS **且 ≠ 200**，
#   **不再要求等于 baseline**。真正的 mutation「POST /time 也返回 200」仍被抓住（200 不在集合里），
#   但合法实现走任意未命中分支都不被误杀。
NOTFOUND_PATH="${BRAIN_URL}/api/brain/__definitely_not_a_route_xyz__"

BASELINE_POST=""
BASELINE_PUT=""
BASELINE_PATCH=""
BASELINE_DELETE=""
for METHOD in POST PUT PATCH DELETE; do
  BASELINE_CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X "$METHOD" \
    -H 'Content-Type: application/json' \
    -d '{}' "$NOTFOUND_PATH" || echo 000)
  echo "[e2e] sanity baseline: ${METHOD} ${NOTFOUND_PATH} -> ${BASELINE_CODE}"
  # Round 6：断言 baseline ∈ ACCEPTABLE_NOT_FOUND_STATUS；若不在集合内（例如返回 200 表明全部路径 200，
  # 或 000 表明 curl 打不通），直接 exit 75 —— 整条 step 8 失去意义时即时暴露
  if ! is_acceptable_not_found "$BASELINE_CODE"; then
    echo "[FAIL 7.5] Brain global NotFound sanity broken — ${METHOD} to nonexistent path returned ${BASELINE_CODE}"
    echo "           Expected status in {${ACCEPTABLE_NOT_FOUND_STATUS}}; got ${BASELINE_CODE}."
    echo "           Either Brain is unreachable (000) or every path returns 200 (fake-impl) or middleware is misconfigured."
    exit 75
  fi
  case "$METHOD" in
    POST)   BASELINE_POST="$BASELINE_CODE" ;;
    PUT)    BASELINE_PUT="$BASELINE_CODE" ;;
    PATCH)  BASELINE_PATCH="$BASELINE_CODE" ;;
    DELETE) BASELINE_DELETE="$BASELINE_CODE" ;;
  esac
done

# ---- step 8: 非 GET 方法 + body 污染免疫 ----
# 约束（Round 6 — Reviewer Round 5 Risk 1）：POST/PUT/PATCH/DELETE 到 /api/brain/time：
#   - 状态码必须 ∈ ACCEPTABLE_NOT_FOUND_STATUS（{401 403 404 405 415 422 429 500}）**且 ≠ 200**
#     （不再要求 == baseline — 允许 Brain 在端点级与全局级有不同 middleware 分支）
#   - 响应体不得出现 iso/timezone/unix key
#   - 即便 POST body 注入 {iso:"evil",unix:1,timezone:"Fake/Zone"} 也不得回显 "evil"/"Fake/Zone" 字面量
# EXPECTED_CODE / BASELINE_{POST,PUT,PATCH,DELETE} 变量保留作为诊断输出（失败时打印对比），
# 但不参与硬断言——硬断言基于 ACCEPTABLE_NOT_FOUND_STATUS 集合判定
for METHOD in POST PUT PATCH DELETE; do
  METHOD_BODY_FILE="$(mktemp)"
  METHOD_CODE=$(curl -sS -X "$METHOD" \
    -H 'Content-Type: application/json' \
    -d '{"iso":"evil","unix":1,"timezone":"Fake/Zone"}' \
    -o "$METHOD_BODY_FILE" -w '%{http_code}' "$ENDPOINT" || echo 000)
  case "$METHOD" in
    POST)   EXPECTED_CODE="$BASELINE_POST" ;;
    PUT)    EXPECTED_CODE="$BASELINE_PUT" ;;
    PATCH)  EXPECTED_CODE="$BASELINE_PATCH" ;;
    DELETE) EXPECTED_CODE="$BASELINE_DELETE" ;;
  esac
  # Round 6 松绑：只要状态 ∈ ACCEPTABLE_NOT_FOUND_STATUS 且 ≠ 200 即可
  if [ "$METHOD_CODE" = "200" ] || ! is_acceptable_not_found "$METHOD_CODE"; then
    echo "[FAIL 8] ${METHOD} ${ENDPOINT} returned HTTP ${METHOD_CODE};"
    echo "         expected any of {${ACCEPTABLE_NOT_FOUND_STATUS}} and NOT 200"
    echo "         (diagnostic baseline from ${NOTFOUND_PATH}: ${EXPECTED_CODE})"
    echo "         Mutation risk: GET /time correct but ${METHOD} /time exposes handler (status == 200 or unexpected)."
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
