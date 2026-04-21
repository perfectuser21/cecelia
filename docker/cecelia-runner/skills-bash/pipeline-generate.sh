#!/usr/bin/env bash
# pipeline-generate.sh — Stage 4 图生成机（单命令入口）
#
# 搬运自 docs/pipeline-ops-skills/pipeline-generate/SKILL.md，移除 Claude 中间解读步骤。
# 3 步：调 LLM 生成 person-data.json -> 调 V6 node 脚本渲染 9 PNG -> OCR 自检。
set -e
set -o pipefail

# ─── 步骤 1：读 findings + 准备 person-data ─────────────────────────
OUT_DIR="${CONTENT_OUTPUT_DIR}"
FINDINGS="$OUT_DIR/findings.json"
PERSON_DATA="$OUT_DIR/person-data.json"
CARDS_DIR="$OUT_DIR/cards"
mkdir -p "$CARDS_DIR"

if [ ! -f "$FINDINGS" ]; then
  echo "{\"person_data_path\":null,\"cards_dir\":\"$CARDS_DIR\",\"error\":\"missing findings\"}"
  exit 0
fi

echo "[generate] out_dir=$OUT_DIR findings=$FINDINGS cards=$CARDS_DIR" >&2

# ─── 步骤 2：调 Brain LLM 生成 person-data.json ─────────────────────
KEYWORD=$(python3 -c "import json; print(json.load(open('$FINDINGS')).get('keyword',''))")
FINDINGS_SUMMARY=$(python3 -c "
import json
d = json.load(open('$FINDINGS'))
fs = d.get('findings', [])[:7]
for i, f in enumerate(fs):
    print(f'{i+1}. {f.get(\"title\",\"\")[:80]}: {(f.get(\"content\") or \"\")[:400]}')
")

PROMPT=$(cat <<PROMPT_END
为关键词「${KEYWORD}」生成 V6 人物卡片 person-data.json，严格遵守字段字符预算（中文按字符计）。

## findings（参考）
${FINDINGS_SUMMARY}

## 硬预算（超出会渲染溢出，必须内截断）
- name <= 6, handle <= 14, headline <= 14
- key_stats[3]: val <= 6, label <= 8, sub <= 10
- flywheel[4] 每个 <= 4
- flywheel_insight <= 20, quote <= 24
- timeline[5]: year <= 7, title <= 11, desc <= 20
- day_schedule[4]: time <= 8, title <= 8, desc <= 20
- qa[4]: q <= 14, a <= 28

## 硬规则
- name 不得是整 keyword，要提炼核心短词
- 数组长度必须精确：key_stats=3, flywheel=4, timeline=5, day_schedule=4, qa=4
- 禁止输出"待补充"/"暂无数据"
- handle 用 @<slug> 格式

只输出 JSON（无 fence）。
PROMPT_END
)

BRAIN_URL="${BRAIN_URL:-http://host.docker.internal:5221}"

export PROMPT
LLM_REQ=$(python3 -c "
import json, os
print(json.dumps({'tier':'thalamus','prompt':os.environ['PROMPT'],'max_tokens':3072,'format':'json'}))
")

RESP=$(printf '%s' "$LLM_REQ" | curl -s -X POST "$BRAIN_URL/api/brain/llm-service/generate" \
  -H 'Content-Type: application/json' \
  --data-binary @-)

TEXT=$(echo "$RESP" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    t = (d.get('data') or {}).get('text') or ''
    print(t)
except Exception:
    print('')
" 2>/dev/null | sed 's/^```json//' | sed 's/^```//' | sed 's/```$//')

if [ -z "$TEXT" ]; then
  echo "[generate] LLM empty: $(echo "$RESP" | head -c 200)" >&2
  echo "{\"person_data_path\":null,\"cards_dir\":\"$CARDS_DIR\",\"error\":\"LLM 生成 person-data 失败\"}"
  exit 0
fi
echo "$TEXT" > "$PERSON_DATA"
echo "[generate] person-data written to $PERSON_DATA" >&2

# ─── 步骤 3：调 V6 渲染脚本 ────────────────────────────────────────
SLUG=$(echo "$KEYWORD" | python3 -c "
import sys, re, hashlib
t = sys.stdin.read().strip()
t_ascii = re.sub(r'[^a-zA-Z0-9-]', '', t)
if not t_ascii or len(t_ascii) < 3:
    t_ascii = 'pipe-' + hashlib.md5(t.encode()).hexdigest()[:8]
print(t_ascii[:40])
")

cd /home/cecelia/v6-runtime
node gen-v6-person.mjs --data "$PERSON_DATA" --slug "$SLUG" 2>&1 | tail -20 >&2

# V6 写到 /home/cecelia/claude-output/images/，拷到 pipeline 的 cards/
cp /home/cecelia/claude-output/images/${SLUG}*.png "$CARDS_DIR/" 2>/dev/null || true

# ─── 步骤 3.5：渲染后 OCR 自检（防空字废图）────────────────────────
COVER=$(ls "$CARDS_DIR"/*cover*.png 2>/dev/null | head -1)
if [ -z "$COVER" ]; then
  echo "{\"person_data_path\":\"$PERSON_DATA\",\"cards_dir\":\"$CARDS_DIR\",\"error\":\"cover PNG missing\"}"
  exit 1
fi

OCR_TEXT=$(tesseract "$COVER" - -l chi_sim 2>/dev/null | tr -d '[:space:]')
OCR_LEN=${#OCR_TEXT}
echo "[generate] OCR len=$OCR_LEN" >&2

if [ "$OCR_LEN" -lt 10 ]; then
  echo "{\"person_data_path\":\"$PERSON_DATA\",\"cards_dir\":\"$CARDS_DIR\",\"error\":\"cover OCR len=${OCR_LEN} < 10, 字体可能未加载\"}"
  exit 1
fi

# ─── 步骤 4：输出 JSON ──────────────────────────────────────────────
PNG_COUNT=$(ls "$CARDS_DIR"/*.png 2>/dev/null | wc -l | tr -d ' ')
echo "{\"person_data_path\":\"$PERSON_DATA\",\"cards_dir\":\"$CARDS_DIR\",\"png_count\":${PNG_COUNT}}"
