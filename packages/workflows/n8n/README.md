# N8N Workflows

Cecelia 系统使用的 N8N 工作流定义。

## 工作流列表

| Workflow | 描述 | Webhook | 触发方式 |
|----------|------|---------|----------|
| **cecelia-launcher-v2** | 启动 Cecelia 任务 | `/webhook/cecelia-start` | Webhook / 手动 |
| **cecelia-callback-handler** | 处理 Cecelia 执行回调 | `/webhook/cecelia-callback` | Webhook |
| **devgate-nightly-push** | 每日构建推送到飞书 | - | Cron (每天 01:00) |

## 工作流详情

### cecelia-launcher-v2

**功能**：接收 PRD 并启动 Cecelia 无头执行

**输入**：
```json
{
  "project": "项目名称",
  "prd": "PRD 内容",
  "checkpoint_id": "CP-001（可选）"
}
```

**流程**：
```
Webhook Start
    ↓
Build Prompt (生成 /dev prompt)
    ↓
HTTP Request → Cecelia Bridge (localhost:3457)
    ↓
返回 task_id 和 log_file
```

### cecelia-callback-handler

**功能**：接收 Cecelia 执行完成的回调，更新 Notion 状态

**输入**：
```json
{
  "task_id": "xxx",
  "status": "success|error",
  "pr_url": "https://...",
  "log_file": "/tmp/cecelia-xxx.log"
}
```

### devgate-nightly-push

**功能**：每天凌晨 1 点检查 DevGate，推送构建状态到飞书

**触发**：Cron schedule: `0 1 * * *`

## 部署到 N8N

### 方法 1：使用脚本

```bash
# 部署所有 workflows
../scripts/deploy-to-n8n.sh

# 部署单个 workflow
../scripts/deploy-to-n8n.sh cecelia-launcher-v2.json
```

### 方法 2：手动导入

1. 打开 https://n8n.zenjoymedia.media
2. 点击 "Add workflow" → "Import from file"
3. 选择 JSON 文件
4. 激活 workflow

## 从 N8N 导出

```bash
# 导出所有 workflows（备份）
../scripts/backup-from-n8n.sh

# 导出单个 workflow
docker exec n8n-self-hosted n8n export:workflow --id=<workflow_id> --output=/tmp/workflow.json
docker cp n8n-self-hosted:/tmp/workflow.json ./cecelia-launcher-v2.json
```

## 测试

### 测试 cecelia-launcher-v2

```bash
curl -X POST http://localhost:5679/webhook/cecelia-start \
  -H "Content-Type: application/json" \
  -d '{
    "project": "test",
    "prd": "测试任务：创建一个简单的 hello world 函数"
  }'
```

### 测试 cecelia-callback-handler

```bash
curl -X POST http://localhost:5679/webhook/cecelia-callback \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "test-123",
    "status": "success",
    "pr_url": "https://github.com/user/repo/pull/1"
  }'
```

## 注意事项

1. **Webhook URL**: 所有 webhook 都使用 `lastNode` 模式（不需要单独的 Respond 节点）
2. **环境变量**: N8N 中需要配置：
   - `CECELIA_BRIDGE_URL`: http://localhost:3457
   - `NOTION_API_KEY`: 从 ~/.credentials/notion.env 读取
3. **禁止操作**:
   - ❌ 不要在 Code 节点中使用 `child_process`
   - ❌ 不要使用 `execSync` 等系统命令
   - ✅ 使用 HTTP Request 节点调用 Bridge
