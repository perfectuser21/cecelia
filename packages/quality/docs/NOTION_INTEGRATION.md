> ⚠️ **[已废弃 / DEPRECATED]** Brain 已于 PR #501 完全断开 Notion 同步。本文档仅作历史参考，不再维护。

# Notion Integration Guide

> 单向同步 - VPS → Notion（展示层）

---

## 架构原则

**Notion 是 UI，不是数据源**：

```
VPS (Source of Truth)
    │
    │ One-way Sync
    ▼
Notion (Display Layer)
```

- ✅ VPS 是唯一的真相来源（State, Queue, Runs, Evidence）
- ✅ Notion 只用于展示和可视化
- ✅ 同步是单向的（VPS → Notion）
- ❌ 不从 Notion 读取状态（防止漂移）

---

## 数据同步

### 同步的表

| Notion 表 | 数据源 | 更新频率 | 说明 |
|-----------|--------|----------|------|
| **System State** | `state/state.json` | 每次 Heartbeat | 全局系统健康状态 |
| **System Runs** | `runs/` 目录 | 每次 Worker 完成 | 运行历史记录 |

### System State 表结构

| 字段 | 类型 | 示例 | 说明 |
|------|------|------|------|
| Health Status | Select | `ok`, `warning`, `critical` | 系统健康度 |
| Queue Length | Number | 5 | 当前队列长度 |
| Last Run | Date | 2026-01-27 14:30 | 最后一次运行时间 |
| Success Rate | Number | 95.5 | 成功率（%） |
| Total Tasks | Number | 142 | 总任务数 |
| Failed (24h) | Number | 3 | 最近 24 小时失败数 |

### System Runs 表结构

| 字段 | 类型 | 示例 | 说明 |
|------|------|------|------|
| Run ID | Title | `run-uuid-123` | 运行唯一标识 |
| Task ID | Text | `task-uuid-456` | 关联的任务 ID |
| Intent | Select | `runQA`, `fixBug`, `refactor` | 任务意图 |
| Status | Select | `succeeded`, `failed`, `running` | 运行状态 |
| Priority | Select | `P0`, `P1`, `P2` | 优先级 |
| Started At | Date | 2026-01-27 14:30 | 开始时间 |
| Duration | Number | 45 | 持续时间（秒） |
| Evidence | URL | `file:///path/to/evidence` | 证据文件路径 |

---

## 配置步骤

### 1. 获取 Notion API Key

1. 访问 https://www.notion.so/my-integrations
2. 点击 "Create new integration"
3. 填写信息：
   - Name: `Cecelia Quality Sync`
   - Associated workspace: 选择你的工作区
   - Capabilities: 只需要 "Read content" 和 "Update content"
4. 复制 `Internal Integration Token`

### 2. 保存 API Key

```bash
# 方式 1: 使用 credentials skill（推荐）
# 在 Claude Code 中：
# "我有一个 Notion API key: secret_xxx..."
# AI 会自动调用 /credentials skill 保存

# 方式 2: 手动保存
mkdir -p ~/.credentials
echo "secret_xxx..." > ~/.credentials/notion-api-key.txt
chmod 600 ~/.credentials/notion-api-key.txt
```

### 3. 创建 Notion 数据库

在 Notion 中创建两个数据库：

**数据库 1: System State**（单行，持续更新）

```
属性：
- Health Status (Select): ok, warning, critical
- Queue Length (Number)
- Last Run (Date)
- Success Rate (Number)
- Total Tasks (Number)
- Failed (24h) (Number)
```

**数据库 2: System Runs**（多行，追加记录）

```
属性：
- Run ID (Title)
- Task ID (Text)
- Intent (Select): runQA, fixBug, refactor, review, summarize, optimizeSelf
- Status (Select): succeeded, failed, running, queued
- Priority (Select): P0, P1, P2
- Started At (Date)
- Duration (Number)
- Evidence (URL)
```

### 4. 分享数据库给集成

1. 打开 System State 数据库
2. 点击右上角 "..." → "Add connections"
3. 选择 "Cecelia Quality Sync"
4. 对 System Runs 数据库重复上述步骤

### 5. 获取数据库 ID

**方法 1: 从 URL 获取**

```
https://www.notion.so/myworkspace/{database_id}?v={view_id}
                                 ^^^^^^^^^^^^^^
                                 这部分是 database_id
```

**方法 2: 使用 API**

```bash
# 列出所有可访问的数据库
curl -X POST https://api.notion.com/v1/search \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{"filter": {"property": "object", "value": "database"}}'
```

### 6. 配置环境变量

```bash
# 在 ~/.bashrc 或 ~/.zshrc 中添加
export NOTION_API_KEY="secret_xxx..."
export NOTION_STATE_DB_ID="database_id_for_system_state"
export NOTION_RUNS_DB_ID="database_id_for_system_runs"
```

### 7. 测试连接

```bash
bash scripts/notion-sync.sh
```

预期输出：

```
🔗 Notion Sync - 2026-01-27 14:30:00

✅ API key loaded
✅ Connected to Notion API
✅ System State updated (1 record)
✅ System Runs synced (5 new records)

🎉 Sync complete
```

---

## 使用方式

### 手动同步

```bash
# 同步所有数据
bash scripts/notion-sync.sh

# 只同步 System State
bash scripts/notion-sync.sh --state-only

# 只同步 System Runs
bash scripts/notion-sync.sh --runs-only
```

### 自动同步（通过 Heartbeat）

Heartbeat 会在每次检查时自动同步：

```bash
# Heartbeat 流程
Heartbeat 运行 → 检查系统状态 → 同步到 Notion
```

配置 Heartbeat 自动运行：

```bash
# 编辑 crontab
crontab -e

# 添加：每 5 分钟运行一次
*/5 * * * * cd /path/to/cecelia-quality && bash heartbeat/heartbeat.sh >> /tmp/heartbeat.log 2>&1
```

### n8n 自动同步

使用 n8n workflow 实现定时同步：

```json
{
  "nodes": [
    {
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "parameters": {
        "rule": {
          "interval": [{"field": "minutes", "minutesInterval": 5}]
        }
      }
    },
    {
      "name": "Execute Sync",
      "type": "n8n-nodes-base.executeCommand",
      "parameters": {
        "command": "bash /path/to/cecelia-quality/scripts/notion-sync.sh"
      }
    }
  ]
}
```

---

## 脚本实现

### notion-sync.sh 核心逻辑

```bash
#!/bin/bash
# Notion 单向同步脚本

# 1. 读取 state.json
state=$(cat state/state.json)

# 2. 更新 System State 表（PATCH 现有记录）
curl -X PATCH https://api.notion.com/v1/pages/$PAGE_ID \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -d "{
    \"properties\": {
      \"Health Status\": {\"select\": {\"name\": \"ok\"}},
      \"Queue Length\": {\"number\": 5}
    }
  }"

# 3. 创建 System Runs 记录（POST 新记录）
for run in runs/*; do
  curl -X POST https://api.notion.com/v1/pages \
    -H "Authorization: Bearer $NOTION_API_KEY" \
    -H "Notion-Version: 2022-06-28" \
    -d "{
      \"parent\": {\"database_id\": \"$NOTION_RUNS_DB_ID\"},
      \"properties\": {
        \"Run ID\": {\"title\": [{\"text\": {\"content\": \"$run_id\"}}]}
      }
    }"
done
```

### 去重逻辑

防止重复同步同一个 run：

```bash
# 使用 notion_sync 表追踪已同步的记录
sqlite3 db/cecelia.db <<EOF
INSERT OR IGNORE INTO notion_sync (entity_type, entity_id, notion_page_id, synced_at)
VALUES ('run', '$run_id', '$notion_page_id', datetime('now'));
EOF
```

---

## 故障排查

### 问题 1: 403 Forbidden

**症状**: API 返回 403 错误

**原因**: 数据库没有分享给集成

**解决**:
1. 打开 Notion 数据库
2. 点击 "..." → "Add connections"
3. 选择你的集成

### 问题 2: Invalid database_id

**症状**: "database_id is not a valid UUID"

**原因**: 数据库 ID 格式错误

**解决**:
- 确保 ID 格式为 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- 从 URL 中提取时，去掉 `?v=` 之后的部分

### 问题 3: 同步延迟

**症状**: Notion 数据更新慢

**原因**: Heartbeat 间隔太长

**解决**:
- 缩短 Heartbeat 间隔（如 2 分钟）
- 或在 Worker 完成时立即触发同步

### 问题 4: API Rate Limit

**症状**: 429 Too Many Requests

**原因**: 请求过于频繁

**解决**:
- 增加同步间隔
- 批量更新而非逐条更新
- 使用 Notion 的批量 API

---

## 安全考虑

### API Key 保护

- ✅ 存储在 `~/.credentials/` 目录
- ✅ 文件权限设为 600
- ✅ 不提交到 Git
- ✅ 使用环境变量传递
- ❌ 不要硬编码在脚本中

### 数据隐私

- ✅ Notion 数据库设为私有
- ✅ 只同步必要的元数据
- ✅ Evidence 文件保留在 VPS，只同步路径
- ❌ 不同步敏感信息（API keys, tokens）

---

## 高级用法

### 条件同步

只同步失败的 runs：

```bash
bash scripts/notion-sync.sh --filter-status=failed
```

### 批量初始化

导入历史数据到 Notion：

```bash
bash scripts/notion-sync.sh --initial-import --limit=100
```

### 双向同步（不推荐）

虽然架构是单向同步，但如果需要从 Notion 触发任务：

```bash
# 使用 Notion webhook + n8n
Notion 创建任务 → n8n Webhook → Gateway HTTP → Queue
```

**注意**: 仍然不读取 Notion 状态，只用 Notion 作为输入触发器。

---

## 监控和日志

### 同步日志

```bash
# 查看最近的同步日志
tail -f /tmp/notion-sync.log

# 查看同步历史
sqlite3 db/cecelia.db "SELECT * FROM notion_sync ORDER BY synced_at DESC LIMIT 10;"
```

### 同步指标

```sql
-- 成功率
SELECT
  COUNT(CASE WHEN status='success' THEN 1 END) * 1.0 / COUNT(*) as success_rate
FROM notion_sync;

-- 平均延迟
SELECT
  AVG(JULIANDAY(synced_at) - JULIANDAY(created_at)) * 24 * 60 as avg_delay_minutes
FROM notion_sync;
```

---

## 参考资料

- [Notion API 文档](https://developers.notion.com/)
- [Notion API SDK (Node.js)](https://github.com/makenotion/notion-sdk-js)
- [Notion Database API](https://developers.notion.com/reference/database)

---

**版本**: 1.0.0
**最后更新**: 2026-01-27
