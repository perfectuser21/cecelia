# Core Dashboard 快速上手指南

**3 步让 Core 网站看到 Cecelia Quality 的实时状态**

---

## 🎯 目标

让 Core 网站显示 4 块核心内容：
1. ✅ **全局 Health** - 绿/黄/红 + 最近一次 run
2. ✅ **Queue** - 队列长度 + 前 10 个待执行任务
3. ✅ **Runs** - 最近 20 次运行（成功/失败/耗时/摘要）
4. ✅ **RCI/GP 失败清单** - Top failures（可点击进详情）

---

## Step 1: 启动 VPS 端服务（1 分钟）

### 一键启动所有服务

```bash
cd /home/xx/dev/cecelia-quality

# 一键启动 Gateway + API
bash scripts/start-all.sh
```

**这个脚本会自动**：
- ✅ 初始化数据库（如果不存在）
- ✅ 启动 Gateway HTTP（端口 5680）
- ✅ 启动 Dashboard API（端口 5681）
- ✅ 测试服务健康

### 验证服务

```bash
# 测试 Gateway
curl http://localhost:5680/health | jq .

# 测试 API
curl http://localhost:5681/api/health | jq .
curl http://localhost:5681/api/state | jq .
```

---

## Step 2: 集成到 Core 网站（5 分钟）

### 2.1 添加环境变量

在 Core 网站的 `.env.local` 文件中添加：

```bash
NEXT_PUBLIC_CECELIA_API_URL=http://146.190.52.84:5681
```

### 2.2 复制 API 客户端

将 `api/README.md` 中的 TypeScript 代码复制到 Core 网站：

**文件位置**: `lib/cecelia-api.ts`

```bash
# 在 Core 网站目录
mkdir -p lib
# 复制完整的 API 客户端代码（参考 api/README.md）
```

### 2.3 创建 Dashboard 页面

**文件位置**: `app/dashboard/cecelia/page.tsx`

完整代码参考：`docs/CORE_DASHBOARD_INTEGRATION.md`

**或使用最简版本**（先跑起来）：

```tsx
// app/dashboard/cecelia/page.tsx
import { getSystemState } from '@/lib/cecelia-api';

export const revalidate = 30;

export default async function CeceliaDashboard() {
  const state = await getSystemState();

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-4">Cecelia Quality</h1>

      <div className="grid grid-cols-3 gap-4">
        <div className="border p-4 rounded">
          <h3>Health</h3>
          <p className="text-2xl">{state.health}</p>
        </div>

        <div className="border p-4 rounded">
          <h3>Queue Length</h3>
          <p className="text-2xl">{state.queueLength}</p>
        </div>

        <div className="border p-4 rounded">
          <h3>Success Rate</h3>
          <p className="text-2xl">{(state.stats.successRate * 100).toFixed(1)}%</p>
        </div>
      </div>

      <pre className="mt-4 bg-gray-100 p-4 rounded">
        {JSON.stringify(state, null, 2)}
      </pre>
    </div>
  );
}
```

### 2.4 添加导航链接

在 Core 网站的导航中添加：

```tsx
// components/nav.tsx
{
  title: 'Cecelia Quality',
  href: '/dashboard/cecelia',
  icon: ShieldCheckIcon
}
```

---

## Step 3: 测试和验证（1 分钟）

### 3.1 启动 Core 网站

```bash
# 在 Core 网站目录
npm run dev
```

### 3.2 访问 Dashboard

```
http://localhost:3000/dashboard/cecelia
```

### 3.3 检查数据显示

你应该看到：
- ✅ Health 状态
- ✅ Queue Length
- ✅ Success Rate
- ✅ 完整的 State JSON

---

## 故障排查

### 问题 1: API 连接失败

**症状**: Dashboard 显示错误，无法加载数据

**解决**:

```bash
# 1. 检查 VPS 服务是否运行
curl http://146.190.52.84:5681/api/health

# 2. 检查防火墙
sudo ufw status
sudo ufw allow 5681/tcp

# 3. 检查 CORS
# 在 api/server.js 中确认 CORS 配置：
app.use(cors({
  origin: '*', // 或具体的 Core 网站域名
}));
```

### 问题 2: 数据为空

**症状**: Dashboard 显示正常，但数据为空

**解决**:

```bash
# 1. 检查是否有数据
curl http://localhost:5681/api/state | jq .

# 2. 提交测试任务
bash gateway/gateway.sh add cloudcode runQA P0 '{"project":"cecelia-quality"}'

# 3. 执行 Worker
bash worker/worker.sh

# 4. 再次查看
curl http://localhost:5681/api/state | jq .
```

### 问题 3: TypeScript 错误

**症状**: Core 网站构建失败

**解决**:

```bash
# 1. 确保 TypeScript 类型正确
# 参考 api/README.md 中的完整类型定义

# 2. 安装缺失的依赖
npm install

# 3. 检查 tsconfig.json
# 确保包含 lib/cecelia-api.ts
```

---

## 完整的 API 端点

| 端点 | 说明 | 示例 |
|------|------|------|
| `GET /api/state` | 全局状态 | `curl http://localhost:5681/api/state` |
| `GET /api/queue` | 队列状态 | `curl http://localhost:5681/api/queue` |
| `GET /api/runs` | 最近运行 | `curl http://localhost:5681/api/runs?limit=20` |
| `GET /api/runs/:id` | 运行详情 | `curl http://localhost:5681/api/runs/<runId>` |
| `GET /api/failures` | 失败清单 | `curl http://localhost:5681/api/failures` |

---

## 下一步

### P0 完成后（今天）

- [x] VPS 端 API 启动
- [x] Core 网站能看到数据
- [x] 4 块核心内容显示

### P1 增强（明天）

- [ ] 美化 UI（使用 shadcn/ui 组件）
- [ ] 添加 Run Detail 页面
- [ ] 添加实时刷新（30 秒轮询）

### P2 高级功能（后天）

- [ ] 从 Dashboard 下发任务
- [ ] 图表可视化（趋势图）
- [ ] 筛选和搜索
- [ ] 导出报告

---

## 完整文档

- **API 服务器**: `api/README.md`
- **集成指南**: `docs/CORE_DASHBOARD_INTEGRATION.md`
- **MVP 总结**: `MVP_SUMMARY.md`

---

## 管理命令

```bash
# 启动所有服务
bash scripts/start-all.sh

# 停止所有服务
bash scripts/stop-all.sh

# 查看日志
tail -f /tmp/gateway-http.log
tail -f /tmp/cecelia-api.log

# 测试 API
curl http://localhost:5681/api/state | jq .

# 提交任务
bash gateway/gateway.sh add cloudcode runQA P0 '{"project":"cecelia-quality"}'

# 执行任务
bash worker/worker.sh
```

---

## 架构图

```
Core 网站 (Port 3000)
    │
    │ Fetch API
    ▼
Dashboard API (Port 5681)
    │
    │ Read
    ▼
state/queue/runs/db (VPS 本地)
    │
    │ Write
    ▼
Gateway HTTP (Port 5680)
    │
    │ Enqueue
    ▼
Worker → QA Orchestrator → Evidence
```

---

**🎉 恭喜！你的生命体现在有了"前台意识界面"！**

---

**版本**: 1.0.0
**最后更新**: 2026-01-27
