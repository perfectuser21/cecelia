# N8N Workflows

> zenithjoy-engine 提供的 N8N 工作流模板

## 工作流列表

| 文件 | 说明 |
|------|------|
| `workflows/prd-executor.json` | PRD 执行工作流 - 调度 Cecilia 执行 checkpoints |

## 使用方法

### 1. 导入工作流

```bash
# 方法 1: N8N CLI
n8n import:workflow --input=workflows/prd-executor.json

# 方法 2: N8N Web UI
# Settings → Import → 选择 prd-executor.json
```

### 2. 配置环境变量

在 N8N 设置中添加：

| 变量 | 说明 | 示例 |
|------|------|------|
| `DASHBOARD_URL` | Dashboard API 地址 | `http://localhost:3000/api/cecilia` |
| `NOTIFICATION_WEBHOOK` | 通知 Webhook（可选）| Slack/Feishu webhook URL |

### 3. 配置 SSH 凭证

创建 SSH 凭证 "VPS SSH"：
- Host: VPS IP
- Username: xx
- Authentication: Private Key / Password

### 4. 触发工作流

**Webhook 触发**：

```bash
curl -X POST http://n8n:5678/webhook/prd-executor \
  -H "Content-Type: application/json" \
  -d '{
    "prd_path": "/path/to/prd.json",
    "work_dir": "/path/to/project",
    "repo": "zenithjoy-core",
    "feature_branch": "feature/xxx"
  }'
```

**手动触发**：
- 打开 N8N Web UI
- 点击 "Execute Workflow"
- 输入测试数据

## 工作流说明

### prd-executor.json

```
Webhook Trigger
      │
      ▼
Load PRD → Create Dashboard Run → Read PRD File
      │
      ▼
Parse Checkpoints (filter pending)
      │
      ▼
┌─────────────────────────────┐
│  For each checkpoint:       │
│  ┌───────────────────────┐  │
│  │ Check Dependency      │  │
│  │ (skip if not ready)   │  │
│  └───────────┬───────────┘  │
│              │              │
│  ┌───────────▼───────────┐  │
│  │ SSH: cecilia -c CP-X  │  │
│  └───────────┬───────────┘  │
│              │              │
│  ┌───────────▼───────────┐  │
│  │ Parse Result          │  │
│  └───────────┬───────────┘  │
│              │              │
│        ┌─────┴─────┐        │
│        ▼           ▼        │
│    Success      Failed      │
│        │           │        │
│   Update DB   Notify Error  │
└─────────────────────────────┘
      │
      ▼
Notify Complete
```

## 前置依赖

- **N8N**: 已部署并运行
- **Cecilia**: 在 VPS 上安装（来自 zenithjoy-core）
- **Dashboard**: API 服务运行中（来自 zenithjoy-core）
- **SSH 访问**: N8N 能 SSH 到运行 Cecilia 的机器

## 相关文档

- [接口规范](../docs/INTERFACE-SPEC.md)
- [PRD Schema](../templates/prd-schema.json)
- [PRD 示例](../templates/prd-example.json)
