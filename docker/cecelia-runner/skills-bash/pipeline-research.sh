#!/usr/bin/env bash
# pipeline-research.sh — Stage 1 调研机（单命令入口）
#
# 直接入口版：移除 Claude 中间"解读步骤"，所有 bash 逻辑搬运自
# docs/pipeline-ops-skills/pipeline-research/SKILL.md。
#
# 约定：
# - 中间输出全部到 stderr（>&2），方便 docker-executor 抓 debug
# - stdout 只输出最后一行 JSON，供 extractJsonField / extractField 抽字段
# - set -e + pipefail：任一 step 失败立即退出，避免带坏数据到后续 stage
set -e
set -o pipefail

# ─── 步骤 1：准备输出目录 + slug ─────────────────────────────────────
KEYWORD="${CONTENT_PIPELINE_KEYWORD:-${1:-}}"
if [ -z "$KEYWORD" ]; then
  echo '{"findings_path":null,"output_dir":null,"error":"missing CONTENT_PIPELINE_KEYWORD"}'
  exit 0
fi

SLUG=$(echo "$KEYWORD" | python3 -c "
import sys, re
t = sys.stdin.read().strip()
t = re.sub(r'[^a-zA-Z0-9\u4e00-\u9fff-]', '-', t)
t = re.sub(r'-+', '-', t)[:40]
print(t)
")
TODAY=$(date +%Y-%m-%d)
OUT_DIR="/home/cecelia/content-output/research/solo-company-case-${SLUG}-${TODAY}"
mkdir -p "$OUT_DIR"
FINDINGS="$OUT_DIR/findings.json"

echo "[research] keyword=$KEYWORD slug=$SLUG out_dir=$OUT_DIR" >&2

# ─── 步骤 2：调 Brain LLM 生成结构化 findings ────────────────────────
PROMPT=$(cat <<PROMPT_END
你是内容研究员。为关键词「${KEYWORD}」生成 10 条结构化调研素材。

要求：
1. 每条 title <= 40 字，content 100-400 字
2. 围绕"超级个体 / 一人公司 / AI 能力下放"的场景
3. 提供具体数据点、案例、工具名（即使是示例）
4. 不得输出"待补充"/"暂无"/占位符

只输出严格 JSON，不要 markdown fence，不要解释：

{
  "keyword": "${KEYWORD}",
  "series": "solo-company-case",
  "total_findings": 10,
  "findings": [
    {"id":"f001","title":"...","content":"...","source":"LLM","brand_relevance":4,"used_in":[]}
  ]
}
PROMPT_END
)

BRAIN_URL="${BRAIN_URL:-http://host.docker.internal:5221}"

# 打包 LLM 请求体（用 python 处理大段中文 JSON 转义，避免 shell "argv too long"）
export PROMPT
LLM_REQ=$(python3 -c "
import json, os
print(json.dumps({'tier':'thalamus','prompt':os.environ['PROMPT'],'max_tokens':8192,'timeout':180,'format':'json'}))
")

# 用 --data-binary @- + printf stdin 投递，防 argv 过长
RESP=$(printf '%s' "$LLM_REQ" | curl -s -X POST "$BRAIN_URL/api/brain/llm-service/generate" \
  -H 'Content-Type: application/json' \
  --data-binary @-)

TEXT=$(echo "$RESP" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    t = (d.get('data') or {}).get('text') or (d.get('data') or {}).get('content') or ''
    print(t)
except Exception:
    print('')
" 2>/dev/null)

if [ -z "$TEXT" ]; then
  echo "[research] LLM empty response: $(echo "$RESP" | head -c 300)" >&2
  echo "{\"findings_path\":null,\"output_dir\":\"${OUT_DIR}\",\"error\":\"LLM 返回空\"}"
  exit 0
fi

# 去 markdown fence
TEXT=$(echo "$TEXT" | sed 's/^```json//' | sed 's/^```//' | sed 's/```$//')
echo "$TEXT" > "$FINDINGS"
echo "[research] findings written to $FINDINGS" >&2

# ─── 步骤 3：输出一行 JSON ─────────────────────────────────────────
COUNT=$(python3 -c "
import json
try:
    d = json.load(open('$FINDINGS'))
    print(len(d.get('findings', [])))
except Exception:
    print(0)
" 2>/dev/null || echo 0)

echo "{\"findings_path\":\"${FINDINGS}\",\"output_dir\":\"${OUT_DIR}\",\"count\":${COUNT}}"
