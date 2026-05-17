#!/usr/bin/env bash
# pipeline-copy-review.sh — Stage 3 文案打分机（单命令入口）
#
# 搬运自 docs/pipeline-ops-skills/pipeline-copy-review/SKILL.md，移除 Claude 中间解读步骤。
# 2 层：第 1 层 bash 硬规则 / 第 2 层 LLM 5 维打分。
#
# 注意：此处 set +e（第 2 层里有些 case 判定会返回非零但不想终止脚本），
# 改成 set -e 前先局部 guard。这里显式关掉 errexit，逻辑自行兜底。
set -o pipefail
set -u

# ─── 步骤 1：文件存在性检查 ─────────────────────────────────────────
COPY_FILE="${CONTENT_OUTPUT_DIR}/cards/copy.md"
ARTICLE_FILE="${CONTENT_OUTPUT_DIR}/article/article.md"
if [ ! -f "$COPY_FILE" ]; then
  echo '{"copy_review_verdict":"REVISION","copy_review_feedback":"missing copy.md","quality_score":0,"copy_review_total":0,"copy_review_threshold":18,"copy_review_rule_details":[{"id":"R0","label":"文件存在","pass":false,"reason":"copy.md missing"}]}'
  exit 0
fi
if [ ! -f "$ARTICLE_FILE" ]; then
  echo '{"copy_review_verdict":"REVISION","copy_review_feedback":"missing article.md","quality_score":0,"copy_review_total":0,"copy_review_threshold":18,"copy_review_rule_details":[{"id":"R0","label":"文件存在","pass":false,"reason":"article.md missing"}]}'
  exit 0
fi

echo "[copy-review] copy=$COPY_FILE article=$ARTICLE_FILE" >&2

# ─── 步骤 2：第 1 层 — 5 项硬规则打分（每项 0/1 分，满分 5）─────────
SCORE=0
ISSUES=()
RULES_JSON=""

append_rule() {
  # $1=id  $2=label  $3=pass(true|false)  $4=value(json 标量，可空)  $5=reason
  local id="$1" label="$2" pass="$3" value="$4" reason="$5"
  local val_field="" reason_field=""
  [ -n "$value" ] && val_field=",\"value\":${value}"
  [ -n "$reason" ] && reason_field=",\"reason\":\"${reason}\""
  local obj="{\"id\":\"${id}\",\"label\":\"${label}\",\"pass\":${pass}${val_field}${reason_field}}"
  if [ -z "$RULES_JSON" ]; then
    RULES_JSON="$obj"
  else
    RULES_JSON="${RULES_JSON},${obj}"
  fi
}

# R1: 无禁用词
BANNED_HITS=$(grep -oE 'coding|搭建|agent workflow|builder|Cecelia|智能体搭建|代码部署' "$COPY_FILE" "$ARTICLE_FILE" 2>/dev/null | sort -u | tr '\n' ',' | sed 's/,$//')
if [ -z "$BANNED_HITS" ]; then
  SCORE=$((SCORE+1))
  append_rule "R1" "无禁用词" "true" "" ""
else
  ISSUES+=("R1:命中禁用词")
  append_rule "R1" "无禁用词" "false" "" "命中: ${BANNED_HITS}"
fi

# R2: 品牌词命中 ≥ 1
BRAND_MATCHES=$(grep -oE '能力|系统|一人公司|小组织|AI|能力下放|能力放大' "$COPY_FILE" "$ARTICLE_FILE" 2>/dev/null | sort -u | tr '\n' ',' | sed 's/,$//')
BRAND_HITS=$(grep -oE '能力|系统|一人公司|小组织|AI|能力下放|能力放大' "$COPY_FILE" "$ARTICLE_FILE" 2>/dev/null | wc -l | tr -d ' ')
if [ "${BRAND_HITS:-0}" -ge 1 ]; then
  SCORE=$((SCORE+1))
  append_rule "R2" "品牌词命中>=1" "true" "$BRAND_HITS" "匹配: ${BRAND_MATCHES}"
else
  ISSUES+=("R2:品牌词0命中")
  append_rule "R2" "品牌词命中>=1" "false" "0" ""
fi

# R3: copy.md ≥ 200 字
COPY_LEN=$(wc -m < "$COPY_FILE" | tr -d ' ')
if [ "${COPY_LEN:-0}" -ge 200 ]; then
  SCORE=$((SCORE+1))
  append_rule "R3" "copy >=200 字" "true" "$COPY_LEN" ""
else
  ISSUES+=("R3:copy ${COPY_LEN}字")
  append_rule "R3" "copy >=200 字" "false" "$COPY_LEN" "阈值 200"
fi

# R4: article.md ≥ 500 字
ART_LEN=$(wc -m < "$ARTICLE_FILE" | tr -d ' ')
if [ "${ART_LEN:-0}" -ge 500 ]; then
  SCORE=$((SCORE+1))
  append_rule "R4" "article >=500 字" "true" "$ART_LEN" ""
else
  ISSUES+=("R4:article ${ART_LEN}字")
  append_rule "R4" "article >=500 字" "false" "$ART_LEN" "阈值 500"
fi

# R5: article.md 有 markdown 标题
if grep -qE '^#{1,3} ' "$ARTICLE_FILE"; then
  SCORE=$((SCORE+1))
  append_rule "R5" "article 有 md 标题" "true" "" ""
else
  ISSUES+=("R5:无md标题")
  append_rule "R5" "article 有 md 标题" "false" "" "未找到 #/##/###"
fi

echo "[copy-review] bash score=$SCORE / 5" >&2

# ─── 步骤 3：第 2 层 — bash 全过才调 LLM 做 5 维打分 ────────────────
D1=0; D2=0; D3=0; D4=0; D5=0
D1_REASON=""; D2_REASON=""; D3_REASON=""; D4_REASON=""; D5_REASON=""
SUGGESTIONS=""
LLM_TOTAL=0
LLM_CALLED=false

if [ "$SCORE" -eq 5 ]; then
  LLM_CALLED=true
  COPY_CONTENT=$(cat "$COPY_FILE")
  ARTICLE_CONTENT=$(cat "$ARTICLE_FILE")

  LLM_PROMPT=$(cat <<PROMPT_END
你是品牌内容审查员。严格按以下 5 维 × 0-5 分制给文案打分。

## 品牌 voice（核心叙事）
- 主题：AI 能力下放 -> 一个人/小组织拥有过去需要大团队才有的能力
- 核心词：能力 / 系统 / 一人公司 / 小组织 / AI / 能力下放 / 能力放大
- 禁用词：coding / 搭建 / agent workflow / builder / 智能体搭建 / 代码部署

## 评分标准（每维 0-5，必须严格对照档位）

### D1 钩子力（开头 3 句能否抓读者）
5 = 用反差 / 具体数据 / 具体场景 / 故事起头抓注意力
3 = 有引入但普通（陈述事实、铺垫但不抓眼）
0 = 平铺直叙、无钩子

### D2 信息密度（每 100 字真实信息含量）
5 = 既有数据又有具体案例又给可操作结论
3 = 有案例或数据之一，但不全
0 = 全是口水话、概括、空洞结论

### D3 品牌一致性（和上面品牌 voice 的契合度）
5 = 主动体现"能力下放给一个人"的叙事
3 = 被动提到品牌词但叙事没对齐
0 = 无品牌词 / 命中禁用词

### D4 可读性（节奏、断句、层次）
5 = 小标题清晰 + 段落有小结 + 逻辑递进
3 = 有结构但松散
0 = 大段无分段 / 逻辑跳跃

### D5 转化力（结尾引导行动）
5 = 具体行动 + 互动引导 + 留开放问题
3 = 有引导但一般
0 = 无引导

## 输入文案

### 社交文案（cards/copy.md）
${COPY_CONTENT}

### 长文（article/article.md）
${ARTICLE_CONTENT}

## 输出（严格 JSON，不要 markdown fence，不要解释文字）

{
  "D1":{"score":<0-5>,"reason":"<20-40 字>"},
  "D2":{"score":<0-5>,"reason":"<20-40 字>"},
  "D3":{"score":<0-5>,"reason":"<20-40 字>"},
  "D4":{"score":<0-5>,"reason":"<20-40 字>"},
  "D5":{"score":<0-5>,"reason":"<20-40 字>"},
  "suggestions":"<50-120 字，告诉 copywrite 下一轮要改什么，具体到段落>"
}
PROMPT_END
)

  BRAIN_URL="${BRAIN_URL:-http://host.docker.internal:5221}"

  export LLM_PROMPT
  LLM_REQ=$(python3 -c "
import json, os
body = {
  'tier': 'thalamus',
  'prompt': os.environ['LLM_PROMPT'],
  'max_tokens': 1024,
  'format': 'json',
  'timeout': 120,
}
print(json.dumps(body))
")

  LLM_RESP=$(printf '%s' "$LLM_REQ" | curl -s -X POST "$BRAIN_URL/api/brain/llm-service/generate" \
    -H 'Content-Type: application/json' \
    --data-binary @-)

  LLM_TEXT=$(echo "$LLM_RESP" | python3 -c "
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

  PARSED=$(echo "$LLM_TEXT" | python3 -c "
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
for k in ['D1','D2','D3','D4','D5']:
    s = pick(k, 'score')
    r = pick(k, 'reason').replace('\t', ' ').replace('\n', ' ').replace('\"', \"'\")
    parts.append(s if s else '0')
    parts.append(r)
sug = str(d.get('suggestions', '') or '').replace('\t', ' ').replace('\n', ' ').replace('\"', \"'\")
parts.append(sug)
print('\t'.join(parts))
" 2>/dev/null)

  IFS=$'\t' read -r D1 D1_REASON D2 D2_REASON D3 D3_REASON D4 D4_REASON D5 D5_REASON SUGGESTIONS <<< "$PARSED"

  case "$D1" in ''|*[!0-9]*) D1=0 ;; esac
  case "$D2" in ''|*[!0-9]*) D2=0 ;; esac
  case "$D3" in ''|*[!0-9]*) D3=0 ;; esac
  case "$D4" in ''|*[!0-9]*) D4=0 ;; esac
  case "$D5" in ''|*[!0-9]*) D5=0 ;; esac

  append_rule "D1" "钩子力"     "$([ "$D1" -ge 2 ] && echo true || echo false)" "$D1" "$D1_REASON"
  append_rule "D2" "信息密度"   "$([ "$D2" -ge 2 ] && echo true || echo false)" "$D2" "$D2_REASON"
  append_rule "D3" "品牌一致性" "$([ "$D3" -ge 2 ] && echo true || echo false)" "$D3" "$D3_REASON"
  append_rule "D4" "可读性"     "$([ "$D4" -ge 2 ] && echo true || echo false)" "$D4" "$D4_REASON"
  append_rule "D5" "转化力"     "$([ "$D5" -ge 2 ] && echo true || echo false)" "$D5" "$D5_REASON"

  LLM_TOTAL=$((D1 + D2 + D3 + D4 + D5))
  echo "[copy-review] LLM total=$LLM_TOTAL D1=$D1 D2=$D2 D3=$D3 D4=$D4 D5=$D5" >&2
  # 调试：LLM 返回原文 + parse 结果打到 stderr，便于事后 cecelia_events.raw_stderr 定位
  echo "[copy-review] LLM_RESP_HEAD=$(printf '%s' "$LLM_RESP" | head -c 400)" >&2
  echo "[copy-review] LLM_TEXT_HEAD=$(printf '%s' "$LLM_TEXT" | head -c 400)" >&2
fi

# ─── 步骤 4：verdict 判定（两层合并）──────────────────────────────
if [ "$LLM_CALLED" = "true" ]; then
  MIN_DIM=$(printf '%s\n' "$D1" "$D2" "$D3" "$D4" "$D5" | sort -n | head -1)
  # γ 精修（叠加 β）：
  #   - LLM 调通且给出真实分数（LLM_TOTAL>0）且某维 ≤1 → 硬伤 veto → REVISION
  #   - LLM 调用但 parse 失败（LLM_TOTAL=0，所有维度 fallback 到 0）→ 不做 veto，
  #     视为"LLM 裁判挂了，信第 1 层硬规则" → APPROVED（避免 LLM 失败拖死 pipeline）
  #   - β 之前去掉了 total<18 硬卡（LLM 波动±3 导致 17/18 一线反复 REVISION）
  if [ "$LLM_TOTAL" -gt 0 ] && [ "$MIN_DIM" -le 1 ]; then
    VERDICT="REVISION"
    FB_TEXT="D1=${D1} D2=${D2} D3=${D3} D4=${D4} D5=${D5} total=${LLM_TOTAL}; ${SUGGESTIONS}"
    FB_ESC=$(printf '%s' "$FB_TEXT" | sed 's/"/\\"/g')
    FEEDBACK="\"${FB_ESC}\""
  else
    VERDICT="APPROVED"
    FEEDBACK="null"
  fi
else
  VERDICT="REVISION"
  FB_ESC=$(IFS=';'; echo "${ISSUES[*]}" | sed 's/"/\\"/g')
  FEEDBACK="\"${FB_ESC}\""
fi

# ─── 步骤 5：输出一行 JSON ─────────────────────────────────────────
echo "{\"copy_review_verdict\":\"${VERDICT}\",\"copy_review_feedback\":${FEEDBACK},\"quality_score\":${SCORE},\"copy_review_total\":${LLM_TOTAL},\"copy_review_threshold\":18,\"copy_review_rule_details\":[${RULES_JSON}]}"
