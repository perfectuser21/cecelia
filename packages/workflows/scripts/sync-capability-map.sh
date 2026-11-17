#!/bin/bash
# 自动同步 capability_mapping.json

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_FILE="$PROJECT_ROOT/n8n/capability_mapping.json"

echo "=== 自动生成 capability_mapping.json ==="
echo ""

docker run --rm \
  -v n8n-self-hosted_n8n_data:/data \
  python:3.11-alpine \
  python << 'PYTHON'
import sqlite3
import json

conn = sqlite3.connect('/data/database.sqlite')
cursor = conn.cursor()

# 获取所有 workflows
cursor.execute("""
SELECT 
  COALESCE(f.name, 'unknown') as folder,
  w.name as name,
  w.id as id,
  w.active as active
FROM workflow_entity w
LEFT JOIN folder f ON w.parentFolderId = f.id
WHERE f.name IN ('Cecelia', '自媒体', '基础工具')
ORDER BY f.name, w.name
""")

workflows = cursor.fetchall()
conn.close()

# 自动分类逻辑
def classify_workflow(folder, name):
    """根据文件夹和名称自动分类"""
    # Cecelia 相关
    if folder == 'Cecelia':
        return 'cecelia-automation'
    
    # 自媒体
    if folder == '自媒体':
        if '数据爬取' in name or '数据采集' in name:
            # 已退役的 n8n 采集工作流不再进入共享能力映射。
            return None
        elif '发布' in name:
            return 'content-publish'
    
    # 基础工具
    if folder == '基础工具':
        return 'vps-maintenance'
    
    return None

# 能力定义
capabilities_def = {
    'content-publish': {
        'name': '内容发布',
        'icon': '📤',
        'description': '自动发布内容到各平台'
    },
    'cecelia-automation': {
        'name': 'Cecelia 自动化',
        'icon': '🤖',
        'description': 'Claude Code 自动执行'
    },
    'vps-maintenance': {
        'name': '服务器维护',
        'icon': '🖥️',
        'description': '自动化服务器运维'
    }
}

# 构建能力映射
capabilities_map = {}
for cap_id, cap_def in capabilities_def.items():
    capabilities_map[cap_id] = {
        **cap_def,
        'workflows': []
    }

# 分类 workflows
for folder, name, wf_id, active in workflows:
    cap_id = classify_workflow(folder, name)
    if cap_id:
        role = 'orchestrator' if '[Flow]' in name else 'worker'
        
        capabilities_map[cap_id]['workflows'].append({
            'n8n_name': name,
            'n8n_id': wf_id,
            'role': role,
            'active': bool(active)
        })

# 输出 JSON
result = {
    'version': '1.0.0',
    'generated_at': 'auto',
    'capabilities': list(capabilities_map.values())
}

print(json.dumps(result, ensure_ascii=False, indent=2))
PYTHON

echo ""
echo "✅ capability_mapping.json 已更新"
echo ""
echo "变化："
if [ -f "$OUTPUT_FILE" ]; then
    echo "  查看差异: git diff n8n/capability_mapping.json"
else
    echo "  新创建"
fi
