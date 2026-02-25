# N8N Workflows

> zenithjoy-engine 提供的 N8N 工作流模板

## 工作流列表

| 文件 | 说明 |
|------|------|
| `workflows/prd-executor-simple.json` | PRD 执行工作流 (HTTP) - 通过本地 HTTP 调用 Cecilia |

## 使用方法

### 1. 导入工作流

```bash
# 方法 1: N8N CLI
n8n import:workflow --input=workflows/prd-executor-simple.json

# 方法 2: N8N Web UI
# Settings → Import → 选择 prd-executor-simple.json
```

### 2. 启动 Cecilia HTTP 服务

```bash
# 在 VPS 上启动 Cecilia HTTP 服务（监听 8899 端口）
cecilia --serve --port 8899
```

### 3. 触发工作流

**Webhook 触发**：

```bash
curl -X POST http://n8n:5678/webhook/cecilia-exec \
  -H "Content-Type: application/json" \
  -d '{
    "prd_path": "/path/to/prd.json",
    "work_dir": "/path/to/project",
    "checkpoint_id": "CP-001",
    "run_all": false
  }'
```

**手动触发**：
- 打开 N8N Web UI
- 点击 "Execute Workflow"
- 输入测试数据

## 工作流说明

### prd-executor-simple.json

```
Webhook Trigger (POST /cecilia-exec)
      │
      ▼
Set Parameters (prd_path, work_dir, checkpoint_id, run_all)
      │
      ▼
HTTP POST → localhost:8899 (Cecilia HTTP 服务)
      │
      ▼
Check Success
      │
  ┌───┴───┐
  ▼       ▼
Success  Failed
  │       │
  ▼       ▼
Output   Output
```

**特点**：
- 简单可靠，无 SSH 命令拼接
- 通过 HTTP 调用本地 Cecilia 服务
- 支持单个 checkpoint 或全部执行

## 前置依赖

- **N8N**: 已部署并运行
- **Cecilia**: HTTP 服务模式运行（`cecilia --serve`）

## 测试

```bash
# 健康检查
cecilia --health

# 执行测试 PRD
cecilia -p n8n/test-prd.json -c CP-001
```

## 相关文档

- [接口规范](../docs/INTERFACE-SPEC.md)
- [PRD Schema](../templates/prd-schema.json)
- [PRD 示例](../templates/prd-example.json)
