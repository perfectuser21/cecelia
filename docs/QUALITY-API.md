# Cecelia Quality API 文档

## 概述

Cecelia Quality 是独立的质量保障系统，专注于 QA 任务执行、证据收集和质量门禁。

**服务地址**:
- 直接访问: `http://localhost:5681`
- 通过 Workspace: `http://localhost:5212/api/quality/*`

**职责边界**:
- ✅ QA 任务执行（测试、审计、门禁）
- ✅ QA 配置管理（repo-registry, qa-policy）
- ✅ QA 状态追踪（执行记录、证据）
- ❌ 通用任务调度（由 Brain 负责）
- ❌ 系统状态管理（由 Workspace 聚合）
- ❌ 决策/编排（由 Brain 负责）

---

## API 端点

### 只读端点（无鉴权）

#### 健康检查

```bash
GET /api/health
```

返回:
```json
{
  "status": "ok"
}
```

#### 系统状态

```bash
GET /api/state
```

返回:
```json
{
  "health": "ok",
  "queueLength": 3,
  "lastRun": {
    "id": "run-123",
    "status": "success",
    "timestamp": "2026-01-30T10:00:00Z"
  },
  "stats": {
    "totalRuns": 100,
    "successRate": 0.95
  }
}
```

#### 队列状态

```bash
GET /api/queue
GET /api/queue?limit=10
```

返回任务队列列表。

#### 执行记录

```bash
GET /api/runs
GET /api/runs?limit=10
GET /api/runs/:runId
GET /api/runs/:runId/result
GET /api/runs/:runId/evidence
GET /api/runs/:runId/evidence/:filename
```

#### Repo 管理

```bash
GET /api/repos
GET /api/repos/:id
```

#### 契约查询

```bash
GET /api/contracts
GET /api/contracts/:repoId
GET /api/contracts/:repoId/rci/:rciId
```

#### 仪表板

```bash
GET /api/dashboard/overview
GET /api/dashboard/repo/:id
GET /api/dashboard/history?days=7
```

---

### 写入端点（需鉴权）

#### 入队 QA 任务

```bash
POST /api/enqueue
```

请求体:
```json
{
  "source": "cloudcode",
  "intent": "runQA",
  "priority": "P0",
  "payload": {
    "repoId": "cecelia-workspace",
    "branch": "cp-feature-x"
  }
}
```

支持的 source: `cloudcode`, `notion`, `chat`, `n8n`, `webhook`, `heartbeat`
支持的 intent: `runQA`, `fixBug`, `refactor`, `review`, `summarize`, `optimizeSelf`

#### 临时执行

```bash
POST /api/execute
```

请求体:
```json
{
  "repoId": "cecelia-workspace",
  "options": {
    "layers": ["L1", "L2A"]
  }
}
```

#### 注册 Repo

```bash
POST /api/repos
```

请求体:
```json
{
  "id": "new-repo",
  "name": "New Repository",
  "path": "/home/xx/dev/new-repo",
  "priority": "P1"
}
```

---

## 通过 Workspace 访问

所有 Quality API 可通过 Workspace 代理访问：

```bash
# 直接访问
curl http://localhost:5681/api/state

# 通过 Workspace（推荐）
curl http://localhost:5212/api/quality/state
```

**注意**: Workspace 会在路径上添加 `/api` 前缀，所以 `/api/quality/state` 会被代理到 Quality 的 `/api/state`。

---

## 架构位置

```
┌─────────────────────────────────────────────────────────────────┐
│              cecelia-workspace (唯一入口)                        │
│                                                                 │
│  /api/quality/*  ──────────────────────────▶  cecelia-quality   │
│                                               (port 5681)       │
└─────────────────────────────────────────────────────────────────┘

cecelia-quality 内部架构:
├── control-plane/    # QA 配置（repo-registry, qa-policy）
├── orchestrator/     # QA 编排（qa-run.sh）
├── gateway/          # 入队网关
├── queue/            # 任务队列
├── worker/           # 任务执行器
├── state/            # 状态存储
├── runs/             # 执行记录
└── api/              # REST API
```

---

## 与其他系统的关系

| 系统 | 关系 |
|------|------|
| **Brain API** | Quality 执行任务，Brain 做决策 |
| **Workspace Core** | Quality 产出证据，Workspace 收集和展示 |
| **Claude Code Skills** | Quality 提供 `/audit`, `/qa`, `/assurance` Skills |

---

## 配置文件

### repo-registry.yaml

定义所有需要质检的 Repo：

```yaml
repos:
  - id: cecelia-workspace
    name: Cecelia Workspace
    path: /home/xx/dev/cecelia-workspace
    priority: P0
    executor:
      qa: pnpm run qa
      rci: pnpm run rci
      gp: pnpm run gp
```

### qa-policy.yaml

定义测试策略：

```yaml
policies:
  fix:
    layers: [L1]
  feat:
    layers: [L1, L2A]
  "feat!":
    layers: [L1, L2A, L2B, L3]
```
