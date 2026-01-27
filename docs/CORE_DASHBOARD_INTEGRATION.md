# Core Dashboard Integration Guide

**将 Cecelia Quality Platform 集成到 Core 网站的完整指南**

---

## 🎯 目标

让 Core 网站（cecelia-frontend / core web）显示 Cecelia Quality Platform 的实时状态，成为生命体的"前台意识界面"。

**4 块核心内容**（P0）：
1. **全局 Health** - 绿/黄/红 + 最近一次 run
2. **Queue** - 队列长度 + 前 10 个待执行任务
3. **Runs** - 最近 20 次运行（成功/失败/耗时/摘要）
4. **RCI/GP 失败清单** - Top failures（可点击进详情）

---

## 架构设计

```
┌────────────────────────────────────────────────────────┐
│                    Core 网站                            │
│                (cecelia-frontend)                       │
│                                                        │
│  ┌─────────────────────────────────────────────────┐  │
│  │     Dashboard 页面 (Next.js/React)              │  │
│  │  ┌───────────┬───────────┬───────────────────┐  │  │
│  │  │ Overview  │ Run Detail│ Queue (optional)  │  │  │
│  │  └─────┬─────┴─────┬─────┴─────┬─────────────┘  │  │
│  │        │           │           │                │  │
│  │        └───────────┴───────────┘                │  │
│  │                    │                            │  │
│  │              Fetch API                          │  │
│  └────────────────────┼─────────────────────────────┘  │
│                       │                                │
└───────────────────────┼────────────────────────────────┘
                        │
                        │ HTTP
                        ▼
┌────────────────────────────────────────────────────────┐
│           Cecelia Quality API (VPS)                    │
│           http://146.190.52.84:5681                    │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │  GET /api/state      - 全局状态                   │ │
│  │  GET /api/queue      - 队列状态                   │ │
│  │  GET /api/runs       - 最近运行                   │ │
│  │  GET /api/runs/:id   - 运行详情                   │ │
│  │  GET /api/failures   - 失败清单                   │ │
│  └──────────────────────────────────────────────────┘ │
│                       │                                │
└───────────────────────┼────────────────────────────────┘
                        │
                        ▼
              state/queue/runs/db
              (VPS 本地数据)
```

---

## Step 1: 启动 API 服务器（VPS 端）

### 1.1 安装依赖

```bash
cd /home/xx/dev/cecelia-quality/api
npm install
```

### 1.2 启动服务器

```bash
# 后台运行
nohup npm start > /tmp/cecelia-api.log 2>&1 &

# 或使用 PM2（推荐）
npm install -g pm2
pm2 start server.js --name cecelia-api
pm2 save
```

### 1.3 测试 API

```bash
# Health check
curl http://localhost:5681/api/health | jq .

# 全局状态
curl http://localhost:5681/api/state | jq .
```

### 1.4 配置 Nginx 反向代理（可选）

如果要通过域名访问：

```nginx
# /etc/nginx/sites-available/cecelia-api
server {
    listen 80;
    server_name api-cecelia.zenjoymedia.media;

    location /api/ {
        proxy_pass http://127.0.0.1:5681/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # CORS (if needed)
        add_header Access-Control-Allow-Origin *;
    }
}
```

---

## Step 2: Core 网站集成（前端端）

### 2.1 环境变量配置

在 Core 网站的 `.env` 文件中添加：

```bash
# .env.local (开发环境)
NEXT_PUBLIC_CECELIA_API_URL=http://146.190.52.84:5681

# 或生产环境
NEXT_PUBLIC_CECELIA_API_URL=https://api-cecelia.zenjoymedia.media
```

### 2.2 创建 API 客户端

创建 `lib/cecelia-api.ts`：

```typescript
// lib/cecelia-api.ts
const API_BASE = process.env.NEXT_PUBLIC_CECELIA_API_URL || 'http://localhost:5681';

export interface SystemState {
  health: 'ok' | 'degraded' | 'unhealthy';
  queueLength: number;
  priorityCounts: {
    P0: number;
    P1: number;
    P2: number;
  };
  lastRun: {
    taskId: string;
    completedAt: string;
    status: string;
  } | null;
  lastHeartbeat: string | null;
  stats: {
    totalTasks: number;
    successRate: number;
  };
  systemHealth: {
    inbox_count: number;
    todo_count: number;
    doing_count: number;
    blocked_count: number;
    done_count: number;
    failed_24h: number;
  };
}

export interface QueueStatus {
  total: number;
  byPriority: {
    P0: number;
    P1: number;
    P2: number;
  };
  tasks: Array<{
    taskId: string;
    source: string;
    intent: string;
    priority: string;
    payload: any;
    createdAt: string;
  }>;
}

export interface Run {
  runId: string;
  createdAt: string;
  task: {
    taskId: string;
    intent: string;
    priority: string;
    source: string;
  } | null;
  status: string;
  duration: number | null;
  exitCode: number | null;
}

export interface RunsResponse {
  runs: Run[];
  stats: {
    total: number;
    succeeded: number;
    failed: number;
    running: number;
  };
}

export interface RunDetail {
  runId: string;
  task: any;
  summary: any;
  result: any;
  evidence: Array<{
    filename: string;
    type: string;
    size: number;
    path: string;
  }>;
  logs: string;
}

export interface FailuresResponse {
  failures: Array<{
    runId: string;
    taskId: string;
    intent: string;
    priority: string;
    createdAt: string;
    exitCode: number;
  }>;
  total: number;
}

// API Functions
export async function getSystemState(): Promise<SystemState> {
  const res = await fetch(`${API_BASE}/api/state`);
  if (!res.ok) throw new Error('Failed to fetch system state');
  return res.json();
}

export async function getQueueStatus(limit = 10): Promise<QueueStatus> {
  const res = await fetch(`${API_BASE}/api/queue?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch queue status');
  return res.json();
}

export async function getRecentRuns(limit = 20, status?: string): Promise<RunsResponse> {
  const url = new URL(`${API_BASE}/api/runs`);
  url.searchParams.set('limit', limit.toString());
  if (status) url.searchParams.set('status', status);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Failed to fetch runs');
  return res.json();
}

export async function getRunDetail(runId: string): Promise<RunDetail> {
  const res = await fetch(`${API_BASE}/api/runs/${runId}`);
  if (!res.ok) throw new Error('Failed to fetch run detail');
  return res.json();
}

export async function getTopFailures(limit = 10): Promise<FailuresResponse> {
  const res = await fetch(`${API_BASE}/api/failures?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch failures');
  return res.json();
}

export async function enqueueTask(task: {
  source: string;
  intent: string;
  priority: string;
  payload: any;
}, token?: string) {
  const res = await fetch(`${API_BASE}/api/enqueue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'x-cecelia-token': token })
    },
    body: JSON.stringify(task)
  });
  if (!res.ok) throw new Error('Failed to enqueue task');
  return res.json();
}
```

### 2.3 创建 Dashboard 页面

#### Page 1: Overview (首页)

创建 `app/dashboard/cecelia/page.tsx`：

```typescript
// app/dashboard/cecelia/page.tsx
import { getSystemState, getQueueStatus, getRecentRuns, getTopFailures } from '@/lib/cecelia-api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableCell, TableHead } from '@/components/ui/table';
import Link from 'next/link';

export const revalidate = 30; // Revalidate every 30 seconds

export default async function CeceliaDashboard() {
  const [state, queue, runs, failures] = await Promise.all([
    getSystemState(),
    getQueueStatus(10),
    getRecentRuns(20),
    getTopFailures(10)
  ]);

  // Determine health color
  const healthColor = state.health === 'ok' ? 'bg-green-500' :
                      state.health === 'degraded' ? 'bg-yellow-500' :
                      'bg-red-500';

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-4xl font-bold mb-8">Cecelia Quality Platform</h1>

      {/* 全局 Health 大卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Health</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <div className={`w-4 h-4 rounded-full ${healthColor}`} />
              <span className="text-2xl font-bold uppercase">{state.health}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Queue Length</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{state.queueLength}</p>
            <div className="text-sm text-muted-foreground mt-2">
              P0: {state.priorityCounts.P0} | P1: {state.priorityCounts.P1} | P2: {state.priorityCounts.P2}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Last Run</CardTitle>
          </CardHeader>
          <CardContent>
            {state.lastRun ? (
              <>
                <Badge variant={state.lastRun.status === 'succeeded' ? 'default' : 'destructive'}>
                  {state.lastRun.status}
                </Badge>
                <p className="text-xs text-muted-foreground mt-2">
                  {new Date(state.lastRun.completedAt).toLocaleString()}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">No runs yet</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Success Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {(state.stats.successRate * 100).toFixed(1)}%
            </p>
            <div className="text-sm text-muted-foreground mt-2">
              Total: {state.stats.totalTasks}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Queue 表格 */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Queue (Top 10 Tasks)</CardTitle>
        </CardHeader>
        <CardContent>
          {queue.tasks.length === 0 ? (
            <p className="text-muted-foreground">Queue is empty</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Priority</TableHead>
                  <TableHead>Intent</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
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
                    <TableCell>{task.payload?.project || 'N/A'}</TableCell>
                    <TableCell>{new Date(task.createdAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent Runs 表格 */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Recent Runs (Last 20)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run ID</TableHead>
                <TableHead>Intent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.runs.map((run) => (
                <TableRow key={run.runId}>
                  <TableCell>
                    <Link
                      href={`/dashboard/cecelia/runs/${run.runId}`}
                      className="text-blue-600 hover:underline"
                    >
                      {run.runId.slice(0, 8)}...
                    </Link>
                  </TableCell>
                  <TableCell>{run.task?.intent || 'N/A'}</TableCell>
                  <TableCell>
                    <Badge variant={run.status === 'succeeded' || run.status === 'completed' ? 'default' : 'destructive'}>
                      {run.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{run.duration ? `${run.duration}s` : 'N/A'}</TableCell>
                  <TableCell>{new Date(run.createdAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <Link
                      href={`/dashboard/cecelia/runs/${run.runId}`}
                      className="text-blue-600 hover:underline text-sm"
                    >
                      View →
                    </Link>
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
          <CardTitle>Top Failures (RCI/GP)</CardTitle>
        </CardHeader>
        <CardContent>
          {failures.failures.length === 0 ? (
            <p className="text-muted-foreground">No recent failures 🎉</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run ID</TableHead>
                  <TableHead>Intent</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Exit Code</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failures.failures.map((failure) => (
                  <TableRow key={failure.runId}>
                    <TableCell>
                      <Link
                        href={`/dashboard/cecelia/runs/${failure.runId}`}
                        className="text-blue-600 hover:underline"
                      >
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

#### Page 2: Run Detail

创建 `app/dashboard/cecelia/runs/[runId]/page.tsx`：

```typescript
// app/dashboard/cecelia/runs/[runId]/page.tsx
import { getRunDetail } from '@/lib/cecelia-api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';

export default async function RunDetailPage({ params }: { params: { runId: string } }) {
  const run = await getRunDetail(params.runId);

  return (
    <div className="container mx-auto p-8">
      <div className="mb-4">
        <Link href="/dashboard/cecelia" className="text-blue-600 hover:underline">
          ← Back to Dashboard
        </Link>
      </div>

      <h1 className="text-3xl font-bold mb-8">Run Detail: {run.runId}</h1>

      {/* Summary */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <Badge variant={run.result?.status === 'completed' ? 'default' : 'destructive'}>
                {run.result?.status || run.summary?.status || 'unknown'}
              </Badge>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Intent</p>
              <p className="font-medium">{run.task?.intent}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Priority</p>
              <Badge>{run.task?.priority}</Badge>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Duration</p>
              <p className="font-medium">{run.summary?.duration || 'N/A'}s</p>
            </div>
          </div>

          {run.result?.qa_decision && (
            <div className="mt-4">
              <p className="text-sm text-muted-foreground">QA Decision</p>
              <Badge variant={run.result.qa_decision === 'PASS' ? 'default' : 'destructive'}>
                {run.result.qa_decision}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Evidence */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Evidence Files</CardTitle>
        </CardHeader>
        <CardContent>
          {run.evidence.length === 0 ? (
            <p className="text-muted-foreground">No evidence files</p>
          ) : (
            <ul className="space-y-2">
              {run.evidence.map((file) => (
                <li key={file.filename} className="flex justify-between items-center">
                  <div>
                    <a
                      href={`${process.env.NEXT_PUBLIC_CECELIA_API_URL}${file.path}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {file.filename}
                    </a>
                    <span className="text-sm text-muted-foreground ml-2">
                      ({(file.size / 1024).toFixed(2)} KB)
                    </span>
                  </div>
                  <Badge variant="outline">{file.type}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Logs */}
      <Card>
        <CardHeader>
          <CardTitle>Logs (Last 200 lines)</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="bg-gray-100 p-4 rounded text-xs overflow-x-auto max-h-96 overflow-y-auto">
            {run.logs || 'No logs available'}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
```

---

## Step 3: 导航集成

在 Core 网站的主导航中添加 Cecelia Dashboard 入口：

```typescript
// components/nav.tsx
const navItems = [
  // ... existing items
  {
    title: 'Cecelia Quality',
    href: '/dashboard/cecelia',
    icon: ShieldCheckIcon
  }
];
```

---

## Step 4: 部署检查清单

### VPS 端

- [ ] API 服务器已启动（PM2 或 systemd）
- [ ] 端口 5681 可访问（防火墙规则）
- [ ] Nginx 反向代理配置（如果需要）
- [ ] CORS 配置正确

### Core 网站端

- [ ] 环境变量配置正确
- [ ] API 客户端已创建
- [ ] Dashboard 页面已创建
- [ ] 导航链接已添加
- [ ] 构建成功，无 TypeScript 错误

---

## Step 5: 验证

### 5.1 本地测试

```bash
# 在 Core 网站目录
npm run dev

# 访问
open http://localhost:3000/dashboard/cecelia
```

### 5.2 检查 API 连接

在浏览器开发者工具中查看 Network 面板，确认 API 请求成功。

### 5.3 功能测试

- [ ] Overview 页面显示正常
- [ ] Health 状态正确
- [ ] Queue 列表显示
- [ ] Runs 列表显示
- [ ] 点击 Run ID 跳转到详情页
- [ ] 详情页显示 Summary / Evidence / Logs
- [ ] Top Failures 显示

---

## 安全考虑

### P0（只读 API）

- ✅ 只返回运行状态，无敏感数据
- ✅ 可以公开暴露
- ⚠️ 建议使用 Nginx 限制请求频率

### P1（写入 API）

- ⚠️ POST /api/enqueue 需要鉴权
- ✅ 使用 `x-cecelia-token` header
- ✅ 或限制内网访问

---

## 性能优化

### 缓存策略

```typescript
// Next.js App Router
export const revalidate = 30; // 30 秒 ISR

// 或使用 React Query
const { data } = useQuery({
  queryKey: ['cecelia-state'],
  queryFn: getSystemState,
  refetchInterval: 30000 // 30 秒轮询
});
```

### 懒加载

```typescript
// 大数据表格懒加载
import { Suspense } from 'react';

<Suspense fallback={<LoadingSpinner />}>
  <RunsTable />
</Suspense>
```

---

## 故障排查

### CORS 错误

如果遇到 CORS 错误，在 API 服务器中确保 CORS 配置正确：

```javascript
// api/server.js
app.use(cors({
  origin: 'https://core.zenjoymedia.media',
  credentials: true
}));
```

### API 连接失败

检查防火墙规则：

```bash
# VPS 端
sudo ufw allow 5681/tcp

# 测试连接
curl -I http://146.190.52.84:5681/api/health
```

---

## 下一步

### P1 功能（可选）

- [ ] 实时刷新（WebSocket 或 SSE）
- [ ] 从 Dashboard 下发任务
- [ ] 图表可视化（Chart.js 或 Recharts）
- [ ] 筛选和搜索功能
- [ ] 导出报告（PDF/CSV）

---

**版本**: 1.0.0
**最后更新**: 2026-01-27
