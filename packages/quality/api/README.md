# Cecelia Quality Platform - Dashboard API

**轻量级只读 API，为 Core Dashboard 提供数据**

---

## 快速开始

### 安装依赖

```bash
cd /home/xx/dev/cecelia-quality/api
npm install
```

### 启动服务器

```bash
# 生产模式
npm start

# 或后台运行
nohup npm start > /tmp/cecelia-api.log 2>&1 &

# 开发模式（自动重启）
npm run dev
```

### 测试 API

```bash
# Health check
curl http://localhost:5681/api/health | jq .

# 全局状态
curl http://localhost:5681/api/state | jq .

# 队列状态
curl http://localhost:5681/api/queue | jq .

# 最近运行
curl http://localhost:5681/api/runs | jq .
```

---

## API 端点

### P0 端点（只读，无需鉴权）

#### 1. GET /api/state

**返回**: 全局系统状态

**响应示例**:
```json
{
  "health": "ok",
  "queueLength": 3,
  "priorityCounts": {
    "P0": 1,
    "P1": 1,
    "P2": 1
  },
  "lastRun": {
    "taskId": "uuid",
    "completedAt": "2026-01-27T10:30:00Z",
    "status": "succeeded"
  },
  "lastHeartbeat": "2026-01-27T11:00:00Z",
  "lastSyncNotion": "2026-01-27T10:50:00Z",
  "stats": {
    "totalTasks": 142,
    "successRate": 0.95
  },
  "systemHealth": {
    "inbox_count": 0,
    "todo_count": 2,
    "doing_count": 1,
    "blocked_count": 0,
    "done_count": 139,
    "failed_24h": 3
  },
  "timestamp": "2026-01-27T11:05:00Z"
}
```

---

#### 2. GET /api/queue

**返回**: 队列状态 + 前 N 个任务

**Query 参数**:
- `limit` (default: 10) - 返回任务数量

**响应示例**:
```json
{
  "total": 5,
  "byPriority": {
    "P0": 1,
    "P1": 2,
    "P2": 2
  },
  "tasks": [
    {
      "taskId": "uuid-1",
      "source": "cloudcode",
      "intent": "runQA",
      "priority": "P0",
      "payload": {
        "project": "cecelia-quality",
        "branch": "develop"
      },
      "createdAt": "2026-01-27T10:00:00Z"
    }
  ],
  "timestamp": "2026-01-27T11:05:00Z"
}
```

---

#### 3. GET /api/runs

**返回**: 最近运行列表

**Query 参数**:
- `limit` (default: 20) - 返回数量
- `status` (optional) - 筛选状态（succeeded/failed/running）

**响应示例**:
```json
{
  "runs": [
    {
      "runId": "run-uuid-1",
      "createdAt": "2026-01-27T10:30:00Z",
      "task": {
        "taskId": "task-uuid-1",
        "intent": "runQA",
        "priority": "P0",
        "source": "cloudcode"
      },
      "status": "succeeded",
      "duration": 123,
      "exitCode": 0
    }
  ],
  "stats": {
    "total": 100,
    "succeeded": 95,
    "failed": 3,
    "running": 2
  },
  "timestamp": "2026-01-27T11:05:00Z"
}
```

---

#### 4. GET /api/runs/:runId

**返回**: 单次运行详情 + 证据

**响应示例**:
```json
{
  "runId": "run-uuid-1",
  "task": {
    "taskId": "task-uuid-1",
    "source": "cloudcode",
    "intent": "runQA",
    "priority": "P0",
    "payload": {
      "project": "cecelia-quality",
      "branch": "develop"
    }
  },
  "summary": {
    "status": "succeeded",
    "startedAt": "2026-01-27T10:30:00Z",
    "completedAt": "2026-01-27T10:32:00Z",
    "duration": 123,
    "exitCode": 0
  },
  "result": {
    "status": "completed",
    "intent": "runQA",
    "qa_decision": "PASS"
  },
  "evidence": [
    {
      "filename": "QA-DECISION.md",
      "type": "report",
      "size": 4096,
      "path": "/api/runs/run-uuid-1/evidence/QA-DECISION.md"
    },
    {
      "filename": "AUDIT-REPORT.md",
      "type": "report",
      "size": 2048,
      "path": "/api/runs/run-uuid-1/evidence/AUDIT-REPORT.md"
    }
  ],
  "logs": "... last 200 lines of worker.log ...",
  "timestamp": "2026-01-27T11:05:00Z"
}
```

---

#### 5. GET /api/runs/:runId/evidence/:filename

**返回**: 证据文件下载

**示例**:
```bash
curl http://localhost:5681/api/runs/run-uuid-1/evidence/QA-DECISION.md
```

---

#### 6. GET /api/failures

**返回**: 最近失败的任务（Top failures）

**Query 参数**:
- `limit` (default: 10)

**响应示例**:
```json
{
  "failures": [
    {
      "runId": "run-uuid-fail-1",
      "taskId": "task-uuid-fail-1",
      "intent": "runQA",
      "priority": "P0",
      "createdAt": "2026-01-27T09:00:00Z",
      "exitCode": 1
    }
  ],
  "total": 5,
  "timestamp": "2026-01-27T11:05:00Z"
}
```

---

### P1 端点（写入，需要鉴权）

#### 7. POST /api/enqueue

**功能**: 从 Dashboard 下发任务

**Headers**:
- `x-cecelia-token`: API Token (如果配置了 `CECELIA_API_TOKEN`)

**Request Body**:
```json
{
  "source": "dashboard",
  "intent": "runQA",
  "priority": "P0",
  "payload": {
    "project": "cecelia-quality",
    "branch": "develop"
  }
}
```

**响应示例**:
```json
{
  "success": true,
  "message": "Task enqueued",
  "output": "✅ Task enqueued: uuid\n📊 Queue length: 4"
}
```

---

## 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CECELIA_API_PORT` | 5681 | API 端口 |
| `CECELIA_API_HOST` | 0.0.0.0 | API 主机 |
| `CECELIA_API_TOKEN` | (empty) | API Token（P1 端点鉴权） |

**设置示例**:
```bash
export CECELIA_API_PORT=5681
export CECELIA_API_HOST=0.0.0.0
export CECELIA_API_TOKEN='your-secret-token-here'
```

---

## 安全建议

### P0 阶段（只读 API）

- ✅ 只读端点，风险极低
- ✅ 可以公开暴露（只返回运行状态，无敏感数据）
- ⚠️ 建议使用 Nginx 反向代理（限制访问频率）

### P1 阶段（写入 API）

- ⚠️ POST /api/enqueue 需要鉴权
- ✅ 使用 `x-cecelia-token` header
- ✅ 或限制内网访问（Nginx IP 白名单）

**Nginx 配置示例**:
```nginx
location /api/ {
    proxy_pass http://127.0.0.1:5681/api/;
    proxy_set_header Host $host;

    # 限制请求频率
    limit_req zone=api burst=10;

    # POST 端点额外限制
    location /api/enqueue {
        # 只允许内网
        allow 10.0.0.0/8;
        deny all;

        proxy_pass http://127.0.0.1:5681/api/enqueue;
    }
}
```

---

## 集成到 Core Dashboard

### Step 1: Core 网站环境变量

```bash
# Core 网站 .env 文件
CECELIA_API_URL=http://146.190.52.84:5681
# 或
CECELIA_API_URL=https://api.zenjoymedia.media/cecelia
```

### Step 2: 在 Core 网站中调用 API

**示例（Next.js）**:

```typescript
// lib/cecelia-api.ts
const CECELIA_API = process.env.CECELIA_API_URL || 'http://localhost:5681';

export async function getSystemState() {
  const res = await fetch(`${CECELIA_API}/api/state`);
  return res.json();
}

export async function getQueueStatus() {
  const res = await fetch(`${CECELIA_API}/api/queue`);
  return res.json();
}

export async function getRecentRuns(limit = 20) {
  const res = await fetch(`${CECELIA_API}/api/runs?limit=${limit}`);
  return res.json();
}

export async function getRunDetail(runId: string) {
  const res = await fetch(`${CECELIA_API}/api/runs/${runId}`);
  return res.json();
}

export async function getTopFailures(limit = 10) {
  const res = await fetch(`${CECELIA_API}/api/failures?limit=${limit}`);
  return res.json();
}

export async function enqueueTask(task: {
  source: string;
  intent: string;
  priority: string;
  payload: any;
}) {
  const token = process.env.CECELIA_API_TOKEN;
  const res = await fetch(`${CECELIA_API}/api/enqueue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-cecelia-token': token || ''
    },
    body: JSON.stringify(task)
  });
  return res.json();
}
```

### Step 3: Dashboard 页面示例

**Overview 页面**:

```typescript
// app/dashboard/cecelia/page.tsx
import { getSystemState, getQueueStatus, getRecentRuns, getTopFailures } from '@/lib/cecelia-api';

export default async function CeceliaDashboard() {
  const [state, queue, runs, failures] = await Promise.all([
    getSystemState(),
    getQueueStatus(),
    getRecentRuns(20),
    getTopFailures(10)
  ]);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Cecelia Quality Platform</h1>

      {/* 全局 Health */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Health</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={state.health === 'ok' ? 'success' : 'destructive'}>
              {state.health}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Queue Length</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{state.queueLength}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Last Run</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={state.lastRun?.status === 'succeeded' ? 'success' : 'destructive'}>
              {state.lastRun?.status || 'N/A'}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Success Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{(state.stats?.successRate * 100).toFixed(1)}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Queue Status */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Queue (Top 10)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Priority</TableCell>
                <TableCell>Intent</TableCell>
                <TableCell>Source</TableCell>
                <TableCell>Created</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {queue.tasks.map((task) => (
                <TableRow key={task.taskId}>
                  <TableCell>
                    <Badge variant={task.priority === 'P0' ? 'destructive' : 'default'}>
                      {task.priority}
                    </Badge>
                  </TableCell>
                  <TableCell>{task.intent}</TableCell>
                  <TableCell>{task.source}</TableCell>
                  <TableCell>{new Date(task.createdAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Recent Runs */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Recent Runs (Last 20)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Run ID</TableCell>
                <TableCell>Intent</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Duration</TableCell>
                <TableCell>Created</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.runs.map((run) => (
                <TableRow key={run.runId}>
                  <TableCell>
                    <Link href={`/dashboard/cecelia/runs/${run.runId}`}>
                      {run.runId.slice(0, 8)}...
                    </Link>
                  </TableCell>
                  <TableCell>{run.task?.intent}</TableCell>
                  <TableCell>
                    <Badge variant={run.status === 'succeeded' ? 'success' : 'destructive'}>
                      {run.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{run.duration ? `${run.duration}s` : 'N/A'}</TableCell>
                  <TableCell>{new Date(run.createdAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm">
                      <Link href={`/dashboard/cecelia/runs/${run.runId}`}>
                        View
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Top Failures */}
      <Card>
        <CardHeader>
          <CardTitle>Top Failures</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Run ID</TableCell>
                <TableCell>Intent</TableCell>
                <TableCell>Priority</TableCell>
                <TableCell>Exit Code</TableCell>
                <TableCell>Created</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {failures.failures.map((failure) => (
                <TableRow key={failure.runId}>
                  <TableCell>
                    <Link href={`/dashboard/cecelia/runs/${failure.runId}`}>
                      {failure.runId.slice(0, 8)}...
                    </Link>
                  </TableCell>
                  <TableCell>{failure.intent}</TableCell>
                  <TableCell>
                    <Badge variant="destructive">{failure.priority}</Badge>
                  </TableCell>
                  <TableCell>{failure.exitCode}</TableCell>
                  <TableCell>{new Date(failure.createdAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

---

## 测试

### 测试脚本

```bash
# 保存为 api/test-api.sh
#!/bin/bash

API_URL="http://localhost:5681"

echo "Testing Cecelia Quality API"
echo ""

echo "1. Health check"
curl -s "$API_URL/api/health" | jq .
echo ""

echo "2. Global state"
curl -s "$API_URL/api/state" | jq .
echo ""

echo "3. Queue status"
curl -s "$API_URL/api/queue" | jq .
echo ""

echo "4. Recent runs"
curl -s "$API_URL/api/runs?limit=5" | jq .
echo ""

echo "5. Top failures"
curl -s "$API_URL/api/failures?limit=5" | jq .
echo ""

echo "All tests complete!"
```

---

## 部署

### 方式 1: PM2（推荐）

```bash
# 安装 PM2
npm install -g pm2

# 启动
pm2 start api/server.js --name cecelia-api

# 查看状态
pm2 status

# 查看日志
pm2 logs cecelia-api

# 重启
pm2 restart cecelia-api

# 停止
pm2 stop cecelia-api
```

### 方式 2: Systemd Service

```ini
# /etc/systemd/system/cecelia-api.service
[Unit]
Description=Cecelia Quality API
After=network.target

[Service]
Type=simple
User=xx
WorkingDirectory=/home/xx/dev/cecelia-quality/api
ExecStart=/usr/bin/node /home/xx/dev/cecelia-quality/api/server.js
Restart=always
Environment=CECELIA_API_PORT=5681
Environment=CECELIA_API_HOST=0.0.0.0

[Install]
WantedBy=multi-user.target
```

```bash
# 启动服务
sudo systemctl start cecelia-api
sudo systemctl enable cecelia-api

# 查看状态
sudo systemctl status cecelia-api

# 查看日志
journalctl -u cecelia-api -f
```

---

## 故障排查

### API 无法启动

```bash
# 检查端口占用
lsof -i :5681

# 检查依赖
cd api && npm install

# 手动启动查看错误
node api/server.js
```

### 数据返回为空

```bash
# 检查文件是否存在
ls -lh state/state.json
ls -lh queue/queue.jsonl
ls -lh runs/

# 检查数据库
sqlite3 db/cecelia.db "SELECT COUNT(*) FROM tasks;"
```

---

**版本**: 1.0.0
**最后更新**: 2026-01-27
