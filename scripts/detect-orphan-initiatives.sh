#!/bin/bash
# detect-orphan-initiatives.sh
# 检测孤立 initiatives：父 KR 已取消但 initiative 仍为活跃状态
# 用于自救场景，防止 slots 被僵尸任务占用

set -euo pipefail

DB_URL="${CECELIA_DB_URL:-postgresql://cecelia@localhost/cecelia}"

echo "🔍 检测孤立 initiatives（父 KR 已取消但 initiative 仍活跃）..."

# 查询：projects 表中 type=initiative，关联的 kr 状态为 cancelled，但 initiative 本身不是 archived/cancelled
ORPHANS=$(psql "$DB_URL" -t -A -F'|' -c "
  SELECT p.id, p.name, p.status, p.kr_id
  FROM projects p
  JOIN projects kr ON p.kr_id = kr.id
  WHERE p.type = 'initiative'
    AND kr.status = 'cancelled'
    AND p.status NOT IN ('archived', 'cancelled', 'done')
  ORDER BY p.created_at;
" 2>/dev/null || echo "")

if [[ -z "$ORPHANS" ]]; then
  echo "✅ 未发现孤立 initiatives"
  exit 0
fi

COUNT=$(echo "$ORPHANS" | grep -c '|' || true)
echo "⚠️  发现 $COUNT 个孤立 initiatives："
echo ""
echo "$ORPHANS" | while IFS='|' read -r id name status kr_id; do
  echo "  - [$status] $name (id: ${id:0:8}..., kr: ${kr_id:0:8}...)"
done

echo ""
if [[ "${1:-}" == "--fix" ]]; then
  echo "🔧 执行归档操作..."
  IDS=$(echo "$ORPHANS" | cut -d'|' -f1 | tr '\n' ',' | sed 's/,$//')
  RESULT=$(psql "$DB_URL" -t -c "
    UPDATE projects
    SET status = 'archived', updated_at = NOW()
    WHERE id IN ($(echo "$IDS" | sed "s/[^,]*/'\0'/g"))
      AND type = 'initiative';
  " 2>/dev/null || echo "ERROR")
  echo "✅ 归档结果: $RESULT"
else
  echo "提示：运行 $0 --fix 自动归档上述 initiatives"
fi
