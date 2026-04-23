#!/usr/bin/env bash
# 真机 E2E — GET /api/brain/time（SC-003）
# 对应 tests/ws1/time.test.ts 的核心 BEHAVIOR 断言：
#   - 字段白名单 / unix 类型与位数 / iso 严格 ISO 8601 UTC Z / iso↔unix 一致性
#   - timezone 非空 / query 污染免疫 / 非 GET 方法不泄漏 / body 污染免疫
#
# Round 3 立场（Reviewer Round 2 问题 1&2）：
#   - iso 锁死为 UTC Z 后缀（不允许 ±HH:MM 本地偏移），timezone 字段独立反映服务器元信息
#   - 非 GET 方法 (POST/PUT/PATCH/DELETE) 不得返回 200 且不得泄漏 iso/timezone/unix
#   - POST body {iso,unix,timezone} 不污染响应（handler 根本不执行）
#
# Round 4 立场（Reviewer Round 3 问题 3）：
#   - step 8 状态码收紧为硬枚举 {404, 405}（不再是"非 200"软阈值）
#
# Round 5 立场（Reviewer Round 4 Risk 3）：
#   - 曾尝试"状态码相对化到 baseline"的方案（step 8 要求 == 同 METHOD 对 nonexistent 路径的响应码）
#
# Round 6 立场（Reviewer Round 5 Risk 1）：
#   - 曾尝试"ACCEPTABLE_NOT_FOUND_STATUS = {401 403 404 405 415 422 429 500}"的 8 码枚举
#
# Round 7 立场（Reviewer Round 6 Risk 1/2）：
#   Reviewer 指出"8 码枚举"本身是个枚举而不是规则 —— 合法 Brain 实现若引入枚举外的错误状态
#   （例如 410 Gone、426 Upgrade Required、451 Unavailable For Legal Reasons、503 Service Unavailable、
#   504 Gateway Timeout 等），step 7.5/step 8 都会误杀；而且 step 7.5 的 baseline 集合与 step 8
#   的目标集合**应当同一**（若 baseline 用枚举而 step 8 也用枚举，任何新增合法状态都要两处同步改，
#   覆盖不对称风险长期存在）。
#
#   Round 7 路线（Reviewer Round 6 建议 (b) + Risk 2 一起解决）：
#     放弃枚举，改**原则性规则**：any HTTP 4xx 或 5xx（`400 ≤ code < 600`）。
#     - 200 自动被排除（小于 400）
#     - 000（curl 失败）自动被排除（非数字）
#     - 1xx/3xx（非错误流转/重定向）自动被排除（小于 400）
#     - 枚举外的合法错误码（410/451/503/504 ...）自动被接纳，无需任何代码改动
#     - 真正的 mutation「POST /time 也返回 200」仍被抓住（200 < 400 → 规则拒绝）
#   step 7.5 与 step 8 共用同一函数 `is_http_error_status`，覆盖面对称。
#
#   附带 Round 7 改进（Reviewer Round 6 minor）：step 8 body key 检查从"grep 命中才跑 jq"
#   改为**无条件跑 jq**（对可解析为 JSON 的响应直接断言 `has("iso")/has("unix")/has("timezone")` 均
#   为 false），消除 grep 正则被 JSON 格式变体漏检的风险；不可解析为 JSON 的响应（如 HTML 错误页）
#   仍走字面量 not-contain 的兜底路径。
#
# 依赖: bash, curl, jq
# 用法: BRAIN_URL=http://localhost:5221 bash tests/e2e/brain-time.sh
# 退出码: 0 = 全部通过，非 0 = 第一个失败的步骤编号（75 = step 7.5 baseline sanity 失败）

set -u

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
ENDPOINT="${BRAIN_URL}/api/brain/time"

echo "[e2e] GET ${ENDPOINT}"

# Round 7 — 原则性「合法的未命中/错误响应」规则：HTTP 4xx 或 5xx（400 ≤ code < 600）
# 替换 Round 6 的 ACCEPTABLE_NOT_FOUND_STATUS 8 码枚举；step 7.5 与 step 8 共用此函数，覆盖面对称。
# 规则说明：
#   - 200 自动排除（< 400）—— 任何"handler 被错误执行并返回 200"的 mutation 都被拒
#   - 000（curl 不通/超时）自动排除（非数字）
#   - 合法 4xx 全放行：400/401/403/404/405/410/415/422/426/429/451 ...
#   - 合法 5xx 全放行：500/502/503/504 ...
#   - 非标准 6xx+ 被排除（≥ 600）—— 保留未来扩展空间
is_http_error_status() {
  local code="$1"
  # 非数字（含空串 / 含字母）直接拒
  case "$code" in
    ''|*[!0-9]*) return 1 ;;
  esac
  # 原则性规则：400 ≤ code < 600
  if [ "$code" -ge 400 ] && [ "$code" -lt 600 ]; then
    return 0
  fi
  return 1
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

# ---- step 7.5: sanity baseline（Round 7 原则规则 — Reviewer Round 6 Risk 2） ----
# 对不存在路径发 POST/PUT/PATCH/DELETE，断言 baseline 状态 ∈ 4xx/5xx（原则规则 is_http_error_status）。
# step 7.5 与 step 8 共用同一判定函数，覆盖面对称；任何合法 4xx/5xx（例如 Brain 接入新鉴权返回 401，
# 或 rate-limit 返回 429，或故障返回 503）都自动接受，无需改代码。
# 若 baseline 不是 4xx/5xx（可能返回 200、000、或 3xx 重定向），则 Brain 全局未命中行为异常，
# 整条 step 8 失去意义，立即 exit 75。
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
  # Round 7：原则规则 —— 断言 baseline 是 HTTP 4xx/5xx（400 ≤ code < 600）
  # 同一 Brain 内不同路径可以有不同合法的 4xx/5xx（例如 401 vs 404），不强制相等；
  # 但若某条 method 对 nonexistent 路径返回非 4xx/5xx（例如 200 或 000），说明 Brain 全局路径行为异常。
  if ! is_http_error_status "$BASELINE_CODE"; then
    echo "[FAIL 7.5] Brain global NotFound sanity broken — ${METHOD} to nonexistent path returned ${BASELINE_CODE}"
    echo "           Expected any HTTP 4xx or 5xx (400 <= code < 600); got ${BASELINE_CODE}."
    echo "           Either Brain is unreachable (000), every path returns 200 (fake-impl),"
    echo "           a 3xx redirect is intercepting (misconfig), or a non-standard 6xx+ appeared."
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
# 约束（Round 7 原则规则 — Reviewer Round 6 Risk 1）：POST/PUT/PATCH/DELETE 到 /api/brain/time：
#   - 状态码必须 ∈ 4xx/5xx（is_http_error_status 原则规则；200 天然被排除 — 小于 400）
#     放弃 Round 6 的 8 码枚举，端点级与全局级 middleware 布局不同的合法实现都 pass
#   - 响应体不得出现 iso/timezone/unix key（Round 7 改为无条件 jq 检查 — Reviewer Round 6 minor）
#   - 即便 POST body 注入 {iso:"evil",unix:1,timezone:"Fake/Zone"} 也不得回显 "evil"/"Fake/Zone" 字面量
# BASELINE_{POST,PUT,PATCH,DELETE} 仅保留作为诊断输出（失败时打印参考），不参与硬断言——
# 硬断言基于 is_http_error_status 原则规则，端点与全局的分歧不再误杀
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
  # Round 7：原则规则 —— 状态 ∈ 4xx/5xx 即可（200 天然不在此集合内）
  if ! is_http_error_status "$METHOD_CODE"; then
    echo "[FAIL 8] ${METHOD} ${ENDPOINT} returned HTTP ${METHOD_CODE};"
    echo "         expected any HTTP 4xx or 5xx (400 <= code < 600)"
    echo "         (diagnostic baseline from ${NOTFOUND_PATH}: ${EXPECTED_CODE})"
    echo "         Mutation risk: GET /time correct but ${METHOD} /time exposes handler (status == 200 or unexpected)."
    cat "$METHOD_BODY_FILE"
    rm -f "$METHOD_BODY_FILE"
    exit 8
  fi
  # Round 7（Reviewer Round 6 minor）：body key 检查改为**无条件** jq 判定（解耦 grep 预筛选）
  # 对可解析为 JSON 的响应体，直接断言三字段 key 均不存在；不可解析为 JSON（HTML 错误页/空 body）
  # 则走字面量 not-contain 兜底
  if jq -e . "$METHOD_BODY_FILE" >/dev/null 2>&1; then
    if jq -e 'if type == "object" then (has("iso") or has("unix") or has("timezone")) else false end' "$METHOD_BODY_FILE" >/dev/null 2>&1; then
      echo "[FAIL 8] ${METHOD} response (JSON) leaks iso/unix/timezone keys — body may have been processed"
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
