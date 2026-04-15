#!/usr/bin/env bash
# setup-notebooks.sh — 创建 3 个 Cecelia 专用 NotebookLM 笔记本
#
# 用法：bash packages/brain/scripts/setup-notebooks.sh
#
# 运行条件：
#   - notebooklm CLI 已安装（/opt/homebrew/bin/notebooklm）
#   - notebooklm 已登录（notebooklm login）
#   - PostgreSQL cecelia 数据库可连接（psql cecelia）
#
# 结果：
#   - 3 个笔记本的 ID 存入 working_memory 表
#   - 如果笔记本已存在（working_memory 中有 ID），跳过创建

set -e

NOTEBOOK_CLI="${NOTEBOOKLM_BIN:-/opt/homebrew/bin/notebooklm}"
DB_NAME="${CECELIA_DB:-cecelia}"

# 检查依赖
if ! command -v "$NOTEBOOK_CLI" &>/dev/null; then
  echo "错误：notebooklm CLI 未找到: $NOTEBOOK_CLI" >&2
  exit 1
fi

if ! command -v psql &>/dev/null; then
  echo "错误：psql 未找到，请安装 PostgreSQL 客户端" >&2
  exit 1
fi

# ── 核心函数 ──────────────────────────────────────────────

# 从 working_memory 查询已存在的笔记本 ID
get_existing_id() {
  local config_key=$1
  psql "$DB_NAME" -t -A -c "SELECT value_json FROM working_memory WHERE key = '$config_key' LIMIT 1" 2>/dev/null | tr -d '"' | tr -d ' '
}

# 创建笔记本并存储 ID
create_notebook() {
  local title=$1
  local config_key=$2

  # 检查是否已存在
  local existing_id
  existing_id=$(get_existing_id "$config_key")
  if [[ -n "$existing_id" ]]; then
    echo "✓ $title 已存在（$config_key = ${existing_id:0:8}...）"
    return 0
  fi

  echo "正在创建笔记本：$title ..."
  local output
  output=$("$NOTEBOOK_CLI" create "$title" --json 2>&1)
  local create_exit=$?

  if [[ $create_exit -ne 0 ]]; then
    echo "✗ 创建失败：$title" >&2
    echo "  错误：$output" >&2
    return 1
  fi

  # 提取 notebook ID（JSON 格式：{"id": "...", "title": "..."}）
  local notebook_id
  notebook_id=$(echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id') or d.get('notebook_id',''))" 2>/dev/null)

  if [[ -z "$notebook_id" ]]; then
    # 降级：尝试直接用 notebooklm list --json 找刚创建的
    notebook_id=$("$NOTEBOOK_CLI" list --json 2>/dev/null | python3 -c "
import sys, json
notebooks = json.load(sys.stdin).get('notebooks', [])
for nb in notebooks:
    if nb.get('title') == '$title':
        print(nb.get('id', ''))
        break
" 2>/dev/null)
  fi

  if [[ -z "$notebook_id" ]]; then
    echo "✗ 无法获取笔记本 ID：$title" >&2
    echo "  原始输出：$output" >&2
    return 1
  fi

  # 存入 working_memory
  psql "$DB_NAME" -c "
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ('$config_key', '\"$notebook_id\"', NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = '\"$notebook_id\"', updated_at = NOW();
  " > /dev/null 2>&1

  echo "✓ ${title} → ID: ${notebook_id:0:8}... （已存入 ${config_key}）"
}

# ── 主流程 ────────────────────────────────────────────────

echo ""
echo "=== Cecelia NotebookLM 笔记本初始化 ==="
echo ""

create_notebook "cecelia-working-knowledge" "notebook_id_working"
create_notebook "cecelia-self-model" "notebook_id_self"
create_notebook "cecelia-alex-cognitive-map" "notebook_id_alex"

echo ""
echo "=== 完成，验证存储结果 ==="
psql "$DB_NAME" -c "SELECT key, value_json FROM working_memory WHERE key LIKE 'notebook_id_%' ORDER BY key;"

echo ""
echo "下一步：可以运行 notebooklm list 确认 3 个笔记本已创建。"
