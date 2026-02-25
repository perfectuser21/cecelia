#!/bin/bash
# 从 N8N 导出所有 workflows 到 Git 仓库

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKFLOWS_DIR="$PROJECT_ROOT/n8n/workflows"

echo "=== 从 N8N 导出 Workflows ==="
echo ""

# 清空现有目录（保留目录结构）
rm -f "$WORKFLOWS_DIR"/cecelia/*.json
rm -f "$WORKFLOWS_DIR"/media/*.json
rm -f "$WORKFLOWS_DIR"/tools/*.json

# 使用 Docker 运行 Python 脚本导出
docker run --rm \
  -v n8n-self-hosted_n8n_data:/data \
  -v "$WORKFLOWS_DIR":/output \
  python:3.11-alpine \
  python - << 'PYTHON'
import sqlite3
import json
import os

conn = sqlite3.connect('/data/database.sqlite')
cursor = conn.cursor()

cursor.execute("""
SELECT 
  COALESCE(f.name, 'unknown') as folder,
  w.name as name,
  w.nodes,
  w.connections,
  w.settings,
  w.staticData,
  w.active
FROM workflow_entity w
LEFT JOIN folder f ON w.parentFolderId = f.id
WHERE f.name IN ('Cecelia', '自媒体', '基础工具')
ORDER BY f.name, w.name
""")

results = cursor.fetchall()
conn.close()

# 文件夹映射
folder_map = {
    'Cecelia': '/output/cecelia',
    '自媒体': '/output/media',
    '基础工具': '/output/tools'
}

exported = 0
for folder, name, nodes, connections, settings, static_data, active in results:
    if folder not in folder_map:
        continue
    
    try:
        # 生成文件名
        filename = name.lower()
        filename = filename.replace('[flow] ', 'flow-')
        filename = filename.replace('[unit] ', 'unit-')
        filename = filename.replace(' ', '-')
        filename = filename.replace('/', '-')
        filename = filename + '.json'
        
        # 构建 workflow 数据
        workflow_data = {
            'name': name,
            'nodes': json.loads(nodes) if nodes else [],
            'connections': json.loads(connections) if connections else {},
            'settings': json.loads(settings) if settings else {},
            'staticData': json.loads(static_data) if static_data else {},
            'active': bool(active)
        }
        
        # 保存到文件
        output_path = os.path.join(folder_map[folder], filename)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(workflow_data, f, ensure_ascii=False, indent=2)
        
        print(f"✅ {folder:10} {name}")
        exported += 1
        
    except Exception as e:
        print(f"❌ {folder:10} {name}: {e}")

print(f"\n=== 导出完成: {exported} 个 workflows ===")
PYTHON

echo ""
echo "✅ Workflows 已导出到 $WORKFLOWS_DIR"
echo ""
echo "下一步："
echo "  git status"
echo "  git add n8n/workflows/"
echo "  git commit -m 'chore: 从 N8N 导出 workflows'"
