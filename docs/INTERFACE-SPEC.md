---
id: interface-spec
version: 1.0.0
created: 2026-01-19
updated: 2026-01-21
changelog:
  - 1.0.0: 初始版本
---

# Interface Specification

> N8N ↔ Cecilia ↔ Dashboard 接口规范
>
> zenithjoy-engine 定义规范，zenithjoy-core 实现

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                           N8N                                   │
│                      (本地 VPS 部署)                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │ Webhook     │───▶│ Loop        │───▶│ Notify      │         │
│  │ Trigger     │    │ Tasks       │    │ Result      │         │
│  └─────────────┘    └──────┬──────┘    └─────────────┘         │
└────────────────────────────┼────────────────────────────────────┘
                             │ SSH
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Cecilia (zenithjoy-core)                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │ CLI Entry   │───▶│ Model       │───▶│ Execute     │         │
│  │ cecilia     │    │ Router      │    │ /dev skill  │         │
│  └─────────────┘    └──────┬──────┘    └─────────────┘         │
│                            │                                    │
│            ┌───────────────┴───────────────┐                   │
│            ▼                               ▼                   │
│     ┌───────────┐                   ┌───────────┐             │
│     │ Claude    │                   │ Gemini    │             │
│     │ Code      │                   │ (Google)  │             │
│     └───────────┘                   └───────────┘             │
└─────────────────────────────────────────────────────────────────┘
                             │
                             │ HTTP Callback
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Dashboard (zenithjoy-core)                    │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │ Task List   │    │ Progress    │    │ Stats       │         │
│  │             │    │ Tracker     │    │             │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. Cecilia CLI 接口

### 1.1 命令格式

```bash
cecilia [options]
```

### 1.2 参数

| 参数 | 短参数 | 类型 | 必需 | 说明 |
|------|--------|------|------|------|
| `--prd` | `-p` | string | ✓ | PRD 文件路径或 Notion ID (`notion:xxx`) |
| `--task` | `-t` | string | * | 执行指定 Task ID |
| `--all` | - | boolean | * | 执行所有 pending tasks |
| `--model` | `-m` | string | - | 强制使用指定模型 |
| `--workdir` | `-w` | string | - | 工作目录（默认当前目录）|
| `--callback` | - | string | - | Dashboard 回调 URL |
| `--health` | - | boolean | - | 检查适配器健康状态 |

*`--task` 和 `--all` 二选一

### 1.3 输入：PRD JSON

PRD 格式遵循 `templates/prd-schema.json`，核心字段：

```json
{
  "meta": {
    "project": "zenithjoy-core",
    "feature_branch": "feature/user-auth",
    "status": "approved"
  },
  "tasks": [
    {
      "id": "T-001",
      "name": "初始化模块",
      "type": "code",
      "depends_on": null,
      "size": "small",
      "description": "创建目录结构和类型定义",
      "dod": ["创建 src/auth/ 目录", "定义类型"],
      "verify_commands": ["npm run typecheck"],
      "status": "pending"
    }
  ]
}
```

### 1.4 输出：JSON Result

**成功**：
```json
{
  "success": true,
  "task_id": "T-001",
  "output": "Task completed successfully...",
  "duration": 45000,
  "tokens_used": 12500,
  "cost": 0.15,
  "pr_url": "https://github.com/xxx/yyy/pull/123"
}
```

**失败**：
```json
{
  "success": false,
  "task_id": "T-001",
  "output": "...",
  "error": "Verification failed: npm run typecheck returned exit code 1",
  "duration": 30000
}
```

**批量执行 (`--all`)**：
```json
{
  "total": 4,
  "success": 3,
  "failed": 1,
  "results": {
    "T-001": { "success": true, ... },
    "T-002": { "success": true, ... },
    "T-003": { "success": true, ... },
    "T-004": { "success": false, "error": "..." }
  }
}
```

### 1.5 退出码

| 退出码 | 含义 |
|--------|------|
| 0 | 成功 |
| 1 | 执行失败 |
| 2 | 参数错误 |
| 3 | PRD 加载失败 |
| 4 | 依赖未满足 |

### 1.6 调用示例

```bash
# N8N SSH 节点调用
ssh vps "cd /path/to/project && cecilia -p ./prd.json -t T-001"

# 带回调
ssh vps "cecilia -p ./prd.json -t T-001 --callback http://dashboard:3000/api"

# 健康检查
ssh vps "cecilia --health"
```

---

## 2. Dashboard API 接口

### 2.1 基础信息

- **Base URL**: `http://<host>:3000/api/cecilia`
- **Content-Type**: `application/json`

### 2.2 端点

#### 2.2.1 创建运行

```
POST /runs
```

**Request Body**:
```json
{
  "prd_id": "notion:abc123",
  "repo": "zenithjoy-core",
  "feature_branch": "feature/user-auth",
  "tasks": [
    { "id": "T-001", "name": "初始化模块", "type": "code" },
    { "id": "T-002", "name": "实现功能", "type": "code" }
  ],
  "model": "claude-code"
}
```

**Response** (201):
```json
{
  "id": "run-uuid-xxx",
  "status": "pending",
  "created_at": "2026-01-16T21:00:00Z"
}
```

#### 2.2.2 获取运行详情

```
GET /runs/:runId
```

**Response** (200):
```json
{
  "id": "run-uuid-xxx",
  "prd_id": "notion:abc123",
  "repo": "zenithjoy-core",
  "feature_branch": "feature/user-auth",
  "status": "running",
  "current_task": "T-002",
  "started_at": "2026-01-16T21:00:00Z",
  "ended_at": null,
  "total_cost": 0.15,
  "total_tokens": 12500,
  "progress_percent": 50,
  "tasks": [
    {
      "id": "T-001",
      "name": "初始化模块",
      "status": "done",
      "duration_ms": 45000,
      "pr_url": "https://github.com/xxx/yyy/pull/123"
    },
    {
      "id": "T-002",
      "name": "实现功能",
      "status": "in_progress",
      "started_at": "2026-01-16T21:01:00Z"
    }
  ]
}
```

#### 2.2.3 更新 Task 状态

```
PATCH /tasks/:taskId
```

**Request Body**:
```json
{
  "run_id": "run-uuid-xxx",
  "status": "done",
  "model": "claude-code",
  "tokens_used": 12500,
  "cost": 0.15,
  "pr_url": "https://github.com/xxx/yyy/pull/123",
  "logs": "..."
}
```

**Response** (200):
```json
{
  "success": true
}
```

#### 2.2.4 获取概览

```
GET /overview
```

**Response** (200):
```json
{
  "active_runs": [...],
  "recent_completed": [...],
  "stats": {
    "total_runs": 100,
    "success_rate": 85.5,
    "avg_duration_ms": 120000,
    "total_cost": 45.50,
    "by_model": [
      { "model": "claude-code", "runs": 80, "cost": 40.00 },
      { "model": "gemini", "runs": 20, "cost": 5.50 }
    ]
  }
}
```

#### 2.2.5 查询运行列表

```
GET /runs?status=running&repo=zenithjoy-core&limit=10
```

**Query Parameters**:
- `status`: pending | running | success | failed
- `repo`: 仓库名筛选
- `limit`: 返回数量（默认 50）
- `offset`: 分页偏移

---

## 3. N8N 工作流数据流

### 3.1 触发

```
Notion Webhook / Manual Trigger / Schedule
         │
         ▼
    Load PRD JSON
         │
         ▼
    POST /runs (创建运行记录)
```

### 3.2 循环执行

```
For each task in PRD:
    │
    ├─ Check depends_on status
    │   └─ Skip if dependency not done
    │
    ├─ SSH: cecilia -p ./prd.json -t T-XXX --callback $DASHBOARD_URL
    │
    ├─ Parse JSON output
    │
    └─ Branch:
        ├─ success → Continue to next
        └─ failed → Retry / Stop / Notify
```

### 3.3 完成

```
All tasks done?
    │
    ├─ Yes → PATCH /runs/:id { status: "success" }
    │        → Send success notification
    │
    └─ No (failed) → PATCH /runs/:id { status: "failed" }
                   → Send failure notification
```

---

## 4. 模型选择策略

Cecilia 根据 task 类型自动选择模型：

| Task Type | 默认模型 | 原因 |
|-----------|----------|------|
| `code` | claude-code | 代码能力最强 |
| `test` | claude-code | 测试也需要代码能力 |
| `config` | claude-code | 配置文件修改 |
| `docs` | gemini | 文档可用便宜模型 |
| `review` | gemini | Review 可用便宜模型 |

可通过 `--model` 参数或 task 中的 `model` 字段覆盖。

---

## 5. 错误处理

### 5.1 重试策略

```json
{
  "retry": {
    "max_attempts": 3,
    "delay_ms": 5000,
    "backoff_multiplier": 2
  }
}
```

### 5.2 错误分类

| 错误类型 | 处理方式 |
|----------|----------|
| 网络错误 | 重试 |
| 认证错误 | 停止，通知 |
| 验证失败 | 重试（最多 N 次） |
| 依赖未满足 | 跳过，等待依赖完成 |
| 超时 | 重试 |

---

## 6. 环境变量

### Cecilia

```bash
# 模型 API Keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...

# Dashboard
DASHBOARD_API_URL=http://localhost:3000/api/cecilia

# 默认设置
DEFAULT_MODEL=claude-code
TASK_TIMEOUT_SMALL=300000    # 5 分钟
TASK_TIMEOUT_MEDIUM=600000   # 10 分钟
TASK_TIMEOUT_LARGE=1200000   # 20 分钟
```

### N8N

```bash
# SSH 连接
SSH_HOST=vps-ip
SSH_USER=xx
SSH_KEY_PATH=/path/to/key

# Cecilia 路径
CECILIA_PATH=/home/xx/bin/cecilia

# Dashboard
DASHBOARD_URL=http://dashboard:3000/api/cecilia
```

---

## 7. 实现清单

### zenithjoy-core 需要实现

- [ ] `cecilia/cli.ts` - CLI 入口，解析参数
- [ ] `cecilia/adapters/` - 模型适配器
- [ ] `cecilia/executor.ts` - 执行引擎
- [ ] `dashboard/api/` - REST API 端点
- [ ] `dashboard/services/` - 任务追踪服务

### zenithjoy-engine 提供

- [x] `templates/prd-schema.json` - PRD 格式定义
- [x] `templates/prd-example.json` - PRD 示例
- [x] `n8n/workflows/prd-executor.json` - N8N 工作流模板
- [x] `docs/INTERFACE-SPEC.md` - 本文档
