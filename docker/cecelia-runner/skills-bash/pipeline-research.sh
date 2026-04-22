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

# 调 LLM + 校验 findings 合法 + findings[] ≥ 3 条，不合格重试最多 3 轮
# 防 Claude 返对话性回应（"根据你的需求，我将启动..."）被当作 findings 落盘
call_llm_and_validate() {
  local attempt="$1"
  local prompt_text="$2"
  export PROMPT_TEXT="$prompt_text"
  local llm_req
  llm_req=$(python3 -c "
import json, os
print(json.dumps({'tier':'thalamus','prompt':os.environ['PROMPT_TEXT'],'max_tokens':8192,'timeout':180,'format':'json'}))
")
  local resp
  resp=$(printf '%s' "$llm_req" | curl -s -X POST "$BRAIN_URL/api/brain/llm-service/generate" \
    -H 'Content-Type: application/json' \
    --data-binary @-)
  local text
  text=$(echo "$resp" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    t = (d.get('data') or {}).get('text') or (d.get('data') or {}).get('content') or ''
    print(t)
except Exception:
    print('')
" 2>/dev/null)

  if [ -z "$text" ]; then
    echo "[research] attempt=$attempt LLM 空响应: $(echo "$resp" | head -c 200)" >&2
    return 1
  fi

  # 剥 markdown fence + 抽第一个 balanced JSON 对象（防 LLM 前导对话）
  local cleaned
  cleaned=$(printf '%s' "$text" | python3 -c "
import sys, re, json
raw = sys.stdin.read().strip()
# 先剥 markdown fence
raw = re.sub(r'^\`\`\`json\s*', '', raw)
raw = re.sub(r'^\`\`\`\s*', '', raw)
raw = re.sub(r'\s*\`\`\`\s*$', '', raw)
# 若直接是 JSON 则 OK，否则 greedy 抽 {...}
try:
    json.loads(raw)
    print(raw)
except Exception:
    m = re.search(r'\{[\s\S]*\}', raw)
    if m:
        try:
            json.loads(m.group(0))
            print(m.group(0))
        except Exception:
            print('')
    else:
        print('')
" 2>/dev/null)

  if [ -z "$cleaned" ]; then
    echo "[research] attempt=$attempt 不是合法 JSON: $(printf '%s' "$text" | head -c 200)" >&2
    return 2
  fi

  # 校验 findings[] ≥ 3 条
  local count
  count=$(printf '%s' "$cleaned" | python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
    print(len(d.get('findings', [])))
except Exception:
    print(0)
" 2>/dev/null || echo 0)

  if [ "$count" -lt 3 ]; then
    echo "[research] attempt=$attempt findings 数量=$count 太少" >&2
    return 3
  fi

  # 通过所有校验，写入
  printf '%s' "$cleaned" > "$FINDINGS"
  echo "[research] attempt=$attempt 成功 findings=$count" >&2
  return 0
}

# 最多 3 次尝试，每次 prompt 加强
STRICT_HINT=""
for attempt in 1 2 3; do
  if [ "$attempt" -gt 1 ]; then
    STRICT_HINT="

【重要】上一次你返回了非 JSON 文字（如对话开头/解释）。这次请**直接输出 JSON 对象**，不要任何前导文字、不要思考、不要确认。第一个字符必须是 {。"
  fi
  if call_llm_and_validate "$attempt" "${PROMPT}${STRICT_HINT}"; then
    break
  fi
  if [ "$attempt" -eq 3 ]; then
    echo "[research] 3 次尝试全失败，exit 1 让 LangGraph 标 pipeline failed" >&2
    echo "{\"findings_path\":null,\"output_dir\":\"${OUT_DIR}\",\"error\":\"LLM 连续 3 次返回非 JSON 或 findings 不足\"}"
    exit 1
  fi
done

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
