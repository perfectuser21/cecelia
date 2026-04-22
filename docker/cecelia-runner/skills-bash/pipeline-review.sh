#!/usr/bin/env bash
# pipeline-review.sh — Stage 5 图片评审机（单命令入口）
#
# 搬运自 docs/pipeline-ops-skills/pipeline-review/SKILL.md，移除 Claude 中间解读步骤。
# 2 层：bash 完整性 + 4 维 vision 评审。
set -o pipefail
set -u

# ─── 步骤 1：cards 目录存在 ─────────────────────────────────────────
CARDS_DIR="${CONTENT_OUTPUT_DIR}/cards"
if [ ! -d "$CARDS_DIR" ]; then
  echo '{"image_review_verdict":"FAIL","image_review_feedback":"missing cards/ dir","card_count":0,"vision_avg":0,"vision_threshold":14,"vision_enabled":false,"image_review_rule_details":[]}'
  exit 0
fi

echo "[image-review] cards=$CARDS_DIR" >&2

# ─── 步骤 2：第 1 层 — 每张 PNG 的体积 + 判定 ─────────────────────
PER_IMAGE_JSON=""
PNG_COUNT=0
SMALL_COUNT=0
PASSED_IMGS=()

for f in "$CARDS_DIR"/*.png; do
  [ -f "$f" ] || continue
  PNG_COUNT=$((PNG_COUNT+1))
  NAME=$(basename "$f")
  SIZE=$(stat -f %z "$f" 2>/dev/null || stat -c %s "$f" 2>/dev/null)
  if [ "${SIZE:-0}" -lt 10000 ]; then
    PASS="false"
    REASON=",\"reason\":\"size ${SIZE}B < 10KB\""
    SMALL_COUNT=$((SMALL_COUNT+1))
  else
    PASS="true"
    REASON=""
    PASSED_IMGS+=("$f")
  fi
  OBJ="{\"id\":\"${NAME}\",\"label\":\"${NAME}\",\"pass\":${PASS},\"value\":${SIZE}${REASON}}"
  if [ -z "$PER_IMAGE_JSON" ]; then
    PER_IMAGE_JSON="$OBJ"
  else
    PER_IMAGE_JSON="${PER_IMAGE_JSON},${OBJ}"
  fi
done

echo "[image-review] png_count=$PNG_COUNT small=$SMALL_COUNT" >&2

# ─── 步骤 3：第 2 层 — 4 维 vision 打分 ─────────────────────────────
VISION_RULES_JSON=""
FAIL_ANY_V1=false
FAIL_ANY_V3=false
SUM_TOTAL=0
NUM_IMGS=0
AVG=0
VISION_CALLED=false

BASH_OK=true
[ "$PNG_COUNT" -lt 8 ] && BASH_OK=false
[ "$SMALL_COUNT" -gt 0 ] && BASH_OK=false

VISION_ENABLED="${BRAIN_VISION_ENABLED:-true}"

if [ "$BASH_OK" = "true" ] && [ "$VISION_ENABLED" = "true" ]; then
  VISION_CALLED=true
  BRAIN_URL="${BRAIN_URL:-http://host.docker.internal:5221}"
  PERSON_DATA_FILE="${CONTENT_OUTPUT_DIR}/person-data.json"
  PERSON_DATA_TEXT=$(cat "$PERSON_DATA_FILE" 2>/dev/null || echo "{}")

  for img in "${PASSED_IMGS[@]}"; do
    # NAME 声明为 local 风格（bash 函数外 local 不可用，用显式覆盖；每次循环都重新赋值）
    NAME=$(basename "$img")

    VISION_PROMPT=$(cat <<PROMPT_END
你是图片质量审查员。严格按 4 维 × 0-5 分制评估这张图。

## person-data.json（图上文字应该对应这些数据）
${PERSON_DATA_TEXT}

## 评分标准（每维 0-5，必须严格对照档位）

### V1 文字渲染（图上中文是否完整清晰）
5 = 所有字清晰可读
3 = 大部分字显示
0 = 空字 / 乱码 / 缺字

### V2 数据一致（图上文字是否对得上 person-data）
5 = 精确对应（name/quote/stats 等）
3 = 大致对应
0 = 完全不对 / 张冠李戴

### V3 布局（文字不裁切、不堆叠）
5 = 完美
3 = 有小问题
0 = 严重裁切 / 堆叠

### V4 视觉美感（颜色/间距/层次）
5 = 精致
3 = 合格
0 = 乱 / 丑

## 输出（严格 JSON，不要 markdown fence，不要解释）

{"V1":{"score":<0-5>,"reason":"<20-40 字>"},"V2":{"score":<0-5>,"reason":"..."},"V3":{"score":<0-5>,"reason":"..."},"V4":{"score":<0-5>,"reason":"..."}}
PROMPT_END
)

    # IMG_B64 不走 env（大 env 变量会污染 $NAME 等其他变量，导致 id 为空）。
    # 改 python3 直接读原图 base64。path 走 env 只传字符串。
    export VISION_PROMPT
    export VISION_IMG_PATH="$img"
    V_REQ=$(python3 -c "
import json, os, base64
with open(os.environ['VISION_IMG_PATH'], 'rb') as f:
    img_b64 = base64.b64encode(f.read()).decode('ascii')
body = {
  'tier': 'thalamus',
  'prompt': os.environ['VISION_PROMPT'],
  'image_base64': img_b64,
  'image_mime': 'image/png',
  'max_tokens': 512,
  'format': 'json',
  'timeout': 60,
}
print(json.dumps(body))
")
    unset VISION_IMG_PATH VISION_PROMPT

    VRESP=$(printf '%s' "$V_REQ" | curl -s -X POST "$BRAIN_URL/api/brain/llm-service/vision" \
      -H 'Content-Type: application/json' \
      --data-binary @-)

    VTEXT=$(echo "$VRESP" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    t = (d.get('data') or {}).get('text') or (d.get('data') or {}).get('content') or ''
    t = t.strip()
    if t.startswith('\`\`\`json'): t = t[7:]
    elif t.startswith('\`\`\`'): t = t[3:]
    if t.endswith('\`\`\`'): t = t[:-3]
    print(t.strip())
except Exception:
    print('')
" 2>/dev/null)

    VPARSED=$(echo "$VTEXT" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    d = {}
def pick(k, sub):
    try:
        return str(d.get(k, {}).get(sub, '') or '')
    except Exception:
        return ''
parts = []
for k in ['V1','V2','V3','V4']:
    s = pick(k, 'score')
    r = pick(k, 'reason').replace('\t', ' ').replace('\n', ' ').replace('\"', \"'\")
    parts.append(s if s else '0')
    parts.append(r)
print('\t'.join(parts))
" 2>/dev/null)

    IFS=$'\t' read -r V1 V1_REASON V2 V2_REASON V3 V3_REASON V4 V4_REASON <<< "$VPARSED"
    case "$V1" in ''|*[!0-9]*) V1=0 ;; esac
    case "$V2" in ''|*[!0-9]*) V2=0 ;; esac
    case "$V3" in ''|*[!0-9]*) V3=0 ;; esac
    case "$V4" in ''|*[!0-9]*) V4=0 ;; esac

    TOTAL=$((V1 + V2 + V3 + V4))
    SUM_TOTAL=$((SUM_TOTAL + TOTAL))
    NUM_IMGS=$((NUM_IMGS + 1))

    [ "$V1" -le 1 ] && FAIL_ANY_V1=true
    [ "$V3" -le 1 ] && FAIL_ANY_V3=true

    V_PASS=$([ "$TOTAL" -ge 14 ] && echo true || echo false)
    V1_R=$(printf '%s' "$V1_REASON" | sed 's/"/\\"/g')
    V2_R=$(printf '%s' "$V2_REASON" | sed 's/"/\\"/g')
    V3_R=$(printf '%s' "$V3_REASON" | sed 's/"/\\"/g')
    V4_R=$(printf '%s' "$V4_REASON" | sed 's/"/\\"/g')
    VOBJ="{\"id\":\"vision-${NAME}\",\"label\":\"${NAME} 4 维\",\"pass\":${V_PASS},\"value\":${TOTAL},\"scores\":{\"V1\":${V1},\"V2\":${V2},\"V3\":${V3},\"V4\":${V4}},\"reasons\":{\"V1\":\"${V1_R}\",\"V2\":\"${V2_R}\",\"V3\":\"${V3_R}\",\"V4\":\"${V4_R}\"}}"
    if [ -z "$VISION_RULES_JSON" ]; then
      VISION_RULES_JSON="$VOBJ"
    else
      VISION_RULES_JSON="${VISION_RULES_JSON},${VOBJ}"
    fi
  done

  if [ "$NUM_IMGS" -gt 0 ]; then
    AVG=$((SUM_TOTAL / NUM_IMGS))
  fi
  echo "[image-review] vision sum=$SUM_TOTAL imgs=$NUM_IMGS avg=$AVG" >&2
elif [ "$BASH_OK" = "true" ] && [ "$VISION_ENABLED" != "true" ]; then
  for img in "${PASSED_IMGS[@]}"; do
    NAME=$(basename "$img")
    VOBJ="{\"id\":\"vision-${NAME}\",\"label\":\"${NAME} 4 维\",\"pass\":true,\"value\":0,\"scores\":{\"V1\":0,\"V2\":0,\"V3\":0,\"V4\":0},\"reasons\":{\"V1\":\"vision endpoint pending\",\"V2\":\"vision endpoint pending\",\"V3\":\"vision endpoint pending\",\"V4\":\"vision endpoint pending\"}}"
    if [ -z "$VISION_RULES_JSON" ]; then
      VISION_RULES_JSON="$VOBJ"
    else
      VISION_RULES_JSON="${VISION_RULES_JSON},${VOBJ}"
    fi
  done
fi

# ─── 步骤 4：裁决（2 层合并）──────────────────────────────────────
ISSUES=()
COUNT_RULE_PASS="true"
COUNT_REASON=""
if [ "$PNG_COUNT" -lt 8 ]; then
  ISSUES+=("cards 只有 ${PNG_COUNT} 张 PNG, 期望 >= 8")
  COUNT_RULE_PASS="false"
  COUNT_REASON=",\"reason\":\"只有 ${PNG_COUNT} 张, 期望 >= 8\""
fi
if [ "$SMALL_COUNT" -gt 0 ]; then
  ISSUES+=("${SMALL_COUNT} 张 PNG 小于 10KB（可能空文件）")
fi

COUNT_RULE="{\"id\":\"RCOUNT\",\"label\":\"PNG >= 8 张\",\"pass\":${COUNT_RULE_PASS},\"value\":${PNG_COUNT}${COUNT_REASON}}"

if [ "$BASH_OK" != "true" ]; then
  VERDICT="FAIL"
  FB_ESC=$(IFS=';'; echo "${ISSUES[*]}" | sed 's/"/\\"/g')
  FEEDBACK="\"${FB_ESC}\""
elif [ "$VISION_CALLED" = "true" ]; then
  if [ "$FAIL_ANY_V1" = "true" ] || [ "$FAIL_ANY_V3" = "true" ]; then
    VERDICT="FAIL"
    VISION_FB="avg=${AVG}/20"
    [ "$FAIL_ANY_V1" = "true" ] && VISION_FB="${VISION_FB}; V1 空字/乱码命中"
    [ "$FAIL_ANY_V3" = "true" ] && VISION_FB="${VISION_FB}; V3 严重裁切/堆叠命中"
    FB_ESC=$(printf '%s' "$VISION_FB" | sed 's/"/\\"/g')
    FEEDBACK="\"${FB_ESC}\""
  elif [ "$AVG" -lt 14 ]; then
    VERDICT="REVISION"
    VISION_FB="vision avg=${AVG}/20 低于 14 通过线"
    FB_ESC=$(printf '%s' "$VISION_FB" | sed 's/"/\\"/g')
    FEEDBACK="\"${FB_ESC}\""
  else
    VERDICT="PASS"
    FEEDBACK="null"
  fi
else
  VERDICT="PASS"
  FEEDBACK="null"
fi

# ─── 步骤 5：输出 JSON ──────────────────────────────────────────────
if [ -z "$PER_IMAGE_JSON" ]; then
  RULES="${COUNT_RULE}"
else
  RULES="${COUNT_RULE},${PER_IMAGE_JSON}"
fi
if [ -n "$VISION_RULES_JSON" ]; then
  RULES="${RULES},${VISION_RULES_JSON}"
fi

echo "{\"image_review_verdict\":\"${VERDICT}\",\"image_review_feedback\":${FEEDBACK},\"card_count\":${PNG_COUNT},\"vision_avg\":${AVG},\"vision_threshold\":14,\"vision_enabled\":${VISION_ENABLED},\"image_review_rule_details\":[${RULES}]}"
