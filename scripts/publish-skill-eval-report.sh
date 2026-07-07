#!/usr/bin/env bash
# publish-skill-eval-report.sh — 评估报告 SSH 发布到 HK
# Sprint: 07072314-skill-eval-service
#
# 用法：
#   TASK_ID=<uuid> SKILL_NAME=<name> REPORT_LOCAL_DIR=<path> bash scripts/publish-skill-eval-report.sh
#
# 环境变量（从 ~/.credentials/ 或 Brain env 注入）：
#   TASK_ID             — 任务 UUID（必填）
#   SKILL_NAME          — Skill 名称（必填）
#   REPORT_LOCAL_DIR    — 本地报告目录路径（必填）
#   HK_SSH_HOST         — HK 主机地址（必填，不可写死）
#   HK_SSH_USER         — HK SSH 用户（必填）
#   HK_SSH_KEY          — HK SSH 私钥路径（必填）
#   HK_DOCS_BASE        — HK 文档根目录（default: /data/docs）
#   BRAIN_URL           — Brain API（default: http://localhost:5221）
#
# 输出：
#   report_url 写到 stdout（最后一行）
#
# 铁律：
#   - HK IP / 端口 / 路径禁止写死，全从环境变量读
#   - 凭据不进日志

set -euo pipefail

# ─── 参数校验 ────────────────────────────────────────────────────────────────

: "${TASK_ID:?需要设置 TASK_ID}"
: "${SKILL_NAME:?需要设置 SKILL_NAME}"
: "${REPORT_LOCAL_DIR:?需要设置 REPORT_LOCAL_DIR}"
: "${HK_SSH_HOST:?需要设置 HK_SSH_HOST（禁止写死）}"
: "${HK_SSH_USER:?需要设置 HK_SSH_USER}"
: "${HK_SSH_KEY:?需要设置 HK_SSH_KEY（私钥路径）}"

HK_DOCS_BASE="${HK_DOCS_BASE:-/data/docs}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

if [[ ! -d "${REPORT_LOCAL_DIR}" ]]; then
  echo "[publish] ERROR: REPORT_LOCAL_DIR=${REPORT_LOCAL_DIR} does not exist" >&2
  exit 1
fi

# ─── 生成目标路径 ─────────────────────────────────────────────────────────────

# task 短码：UUID 前 8 位
TASK_SHORT="${TASK_ID:0:8}"

# slug 化 skill 名称（小写、去特殊字符、截断 40）
SKILL_SLUG=$(echo "${SKILL_NAME}" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | cut -c1-40 | sed 's/-$//')

REMOTE_DIR_NAME="${TASK_SHORT}-${SKILL_SLUG}"
REMOTE_REPORT_DIR="${HK_DOCS_BASE}/skill-evals/${REMOTE_DIR_NAME}"
REMOTE_INDEX="${HK_DOCS_BASE}/skill-evals/index.html"

# 报告公网 URL（从环境变量推导，禁止写死域名）
EVAL_REPORT_BASE_URL="${EVAL_REPORT_BASE_URL:-https://docs.zenjoymedia.media/data/docs/skill-evals}"
REPORT_URL="${EVAL_REPORT_BASE_URL}/${REMOTE_DIR_NAME}/index.html"

SSH_OPTS="-i ${HK_SSH_KEY} -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30"

echo "[publish] 开始发布 task=${TASK_ID} skill=${SKILL_NAME}" >&2
echo "[publish] 目标: ${HK_SSH_USER}@${HK_SSH_HOST}:${REMOTE_REPORT_DIR}" >&2

# ─── 创建远端目录 ─────────────────────────────────────────────────────────────

ssh ${SSH_OPTS} "${HK_SSH_USER}@${HK_SSH_HOST}" "mkdir -p '${REMOTE_REPORT_DIR}'"

# ─── rsync 上传报告目录 ────────────────────────────────────────────────────────

rsync -avz --progress \
  -e "ssh ${SSH_OPTS}" \
  "${REPORT_LOCAL_DIR}/" \
  "${HK_SSH_USER}@${HK_SSH_HOST}:${REMOTE_REPORT_DIR}/"

echo "[publish] rsync 完成" >&2

# ─── 追加评估索引页条目 ────────────────────────────────────────────────────────

TIMESTAMP=$(date -u '+%Y-%m-%d %H:%M UTC')
NEW_ENTRY="<tr><td><a href=\"${REMOTE_DIR_NAME}/index.html\">${SKILL_NAME}</a></td><td>${TASK_ID}</td><td>${TIMESTAMP}</td></tr>"

# 检查索引页是否存在，不存在则初始化
INDEX_EXISTS=$(ssh ${SSH_OPTS} "${HK_SSH_USER}@${HK_SSH_HOST}" "test -f '${REMOTE_INDEX}' && echo yes || echo no")

if [[ "${INDEX_EXISTS}" == "no" ]]; then
  echo "[publish] 初始化索引页" >&2
  ssh ${SSH_OPTS} "${HK_SSH_USER}@${HK_SSH_HOST}" "cat > '${REMOTE_INDEX}'" << 'HTML_INIT'
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>Skill 评估索引</title>
<style>body{font-family:sans-serif;padding:24px;max-width:900px;margin:auto}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;text-align:left}
th{background:#f5f5f5}a{color:#5b6af0}h1{margin-bottom:16px}</style></head>
<body><h1>Skill 评估索引</h1>
<table><thead><tr><th>Skill 名称</th><th>任务 ID</th><th>完成时间</th></tr></thead>
<tbody id="entries">
</tbody></table></body></html>
HTML_INIT
fi

# 追加条目（在 </tbody> 之前插入）
ssh ${SSH_OPTS} "${HK_SSH_USER}@${HK_SSH_HOST}" \
  "sed -i 's|</tbody>|${NEW_ENTRY}\n</tbody>|' '${REMOTE_INDEX}'"

echo "[publish] 索引页已更新" >&2

# ─── 回写 Brain skill_evals.report_url + status=completed ─────────────────────

echo "[publish] 回写 Brain report_url..." >&2

curl -sf -X PATCH \
  "${BRAIN_URL}/api/skill-eval/complete" \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"${TASK_ID}\",\"report_url\":\"${REPORT_URL}\"}" \
  || echo "[publish] WARN: Brain 回写失败（手动检查）" >&2

echo "[publish] 发布完成" >&2

# 最后一行输出 report_url（供调用方解析）
echo "${REPORT_URL}"
