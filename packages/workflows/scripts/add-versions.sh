#!/bin/bash
# 批量为 workflows 添加版本号和日期

set -e

TODAY=$(date +%Y%m%d)

echo "=== 批量添加版本号 ==="
echo "日期：$TODAY"
echo ""

docker run --rm \
  -v n8n-self-hosted_n8n_data:/data \
  -e TODAY="$TODAY" \
  python:3.11-alpine \
  python << 'PYTHON'
import sqlite3
import os

conn = sqlite3.connect('/data/database.sqlite')
cursor = conn.cursor()

# 获取所有没有版本号的 workflows
cursor.execute("""
SELECT id, name, active
FROM workflow_entity
WHERE parentFolderId IS NOT NULL
  AND name LIKE '[%'
  AND name NOT LIKE '% v%'
ORDER BY name
""")

workflows = cursor.fetchall()
today = os.environ.get('TODAY', '20260126')

print(f"找到 {len(workflows)} 个需要添加版本号的 workflows\n")

if len(workflows) == 0:
    print("✅ 所有 workflows 都已有版本号")
    exit(0)

print("准备添加版本号：\n")

updates = []
for wf_id, old_name, active in workflows:
    new_name = f"{old_name} v1.0 ({today})"
    status = "🟢" if active else "⚪"
    print(f"{status} {old_name}")
    print(f"   → {new_name}")
    print()
    updates.append((new_name, wf_id))

# 执行更新
for new_name, wf_id in updates:
    cursor.execute("""
        UPDATE workflow_entity
        SET name = ?,
            updatedAt = datetime('now')
        WHERE id = ?
    """, (new_name, wf_id))

conn.commit()
conn.close()

print(f"\n✅ 已更新 {len(updates)} 个 workflows")
PYTHON

echo ""
echo "✅ 完成！刷新 N8N 页面查看"
