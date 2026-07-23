# Sprint PRD — ops-panorama 执行全景面板
**Task ID**: 28e7c41a-9384-405b-9e82-aa5b9871293f  
**Sprint Dir**: sprints/07231722-relay-28e7c41a  
**生成时间**: 2026-07-23  
**优先级**: P2  
**OKR Initiative**: ef9f61f0-8813-4bc4-86bd-768dcc2fbe65  

---

## 一、背景与用户需求

Alex 07-21 原话：  
> "它告诉我们后台多少个任务在跑，多少有头多少无头，CPU内存状态，多少claude多少codex"

当前状态：数据散落在多个端点——  
- 任务状态：`GET /api/brain/tasks?status=in_progress`  
- Claude 账号余量：`GET /api/brain/account-usage`（有 resets_at 字段）  
- LLM 产能快照（含 codex/grok）：`GET /api/brain/dispatch/llm-capacity`  
- 宿主 CPU/内存：`GET /api/brain/vps-monitor/stats`  
- Claude 进程数/有头无头：`GET /api/brain/cluster/scan-sessions`  

无聚合端点，Dashboard 没有对应卡片。

**依赖说明**：task payload.note 指出依赖 0f7dd3d7 刀1 的 llm_capacity 账本先落地。  
检查发现 `/api/brain/dispatch/llm-capacity` 已存在且可用（实测 200，含 vendor 账本）；`/api/brain/account-usage` 也已有 resets_at 字段。**依赖已满足，无需等待**。

---

## 二、交付物

### 交付物 1：`GET /api/brain/ops-panorama`

新建路由文件 `packages/brain/src/routes/ops-panorama.js`，在 `server.js` 注册。

#### 响应结构（规范性 Schema）

```json
{
  "sampled_at": "ISO-8601",
  "tasks": {
    "in_progress_count": 3,
    "in_progress": [
      {
        "id": "28e7c41a",
        "title": "执行全景面板……",
        "priority": "P2",
        "task_type": "harness_initiative",
        "executor_kind": "relay-container",
        "selected_executor": "claude",
        "started_at": "ISO-8601"
      }
    ],
    "vendor_dist": {
      "claude": 1,
      "codex": 0,
      "grok": 0,
      "unknown": 2
    }
  },
  "relay": {
    "container_count": 2,
    "containers": ["cecelia-relay-28e7c41a", "cecelia-relay-50170af2"]
  },
  "sessions": {
    "total": 0,
    "headed": 0,
    "headless": 0
  },
  "host": {
    "cpu_usage_pct": 1.6,
    "load_avg_1m": 1.18,
    "load_avg_5m": 1.15,
    "load_avg_15m": 0.93,
    "mem_total_gb": 9.76,
    "mem_used_gb": 2.27,
    "mem_used_pct": 23.2
  },
  "processes": {
    "claude_total": 0,
    "claude_headed": 0,
    "claude_headless": 0,
    "codex_total": 0
  },
  "llm_capacity": {
    "sentinel": "ok",
    "vendors": {
      "claude": {
        "available_count": 2,
        "total_count": 2,
        "accounts": [
          {
            "name": "account1",
            "available": true,
            "five_hour_pct": 41,
            "seven_day_pct": 32,
            "resets_at": "2026-07-23T10:39:59.516Z"
          },
          {
            "name": "account2",
            "available": false,
            "five_hour_pct": 0,
            "seven_day_pct": 100,
            "resets_at": "2026-07-27T06:59:59.715Z"
          }
        ]
      },
      "codex": {
        "available_count": 1,
        "total_count": 5,
        "accounts": [
          { "name": "team1", "available": true, "used_percent": 20 },
          { "name": "team2", "available": false, "used_percent": 100 }
        ]
      },
      "grok": {
        "available_count": 0,
        "total_count": 1,
        "accounts": []
      }
    }
  }
}
```

#### 数据来源映射

| 字段组 | 来源 | 实现方式 |
|--------|------|----------|
| `tasks.*` | DB `tasks` 表 | `SELECT id,title,priority,task_type,executor_kind,payload->>'allocation' AS alloc,started_at FROM tasks WHERE status='in_progress'` |
| `tasks.vendor_dist` | DB + payload | 从 `payload.allocation.selected_executor` 统计；`executor_kind` 做 fallback |
| `relay.container_count` | 宿主 shell | `docker ps --filter "name=cecelia-relay" --format "{{.Names}}"` |
| `sessions.*` | 复用 `/cluster/scan-sessions` 逻辑 | 直接 import `execSync` 扫 `ps aux` |
| `host.*` | 复用 vps-monitor 逻辑 | `os.loadavg()`, `os.totalmem()`, `os.freemem()`, top CPU |
| `processes.*` | 宿主 shell | `ps aux | grep -E " claude( |$)"` 区分 -p 有无；`ps aux | grep codex` |
| `llm_capacity.*` | 复用 `getLlmCapacitySnapshot()` | import from `../llm-capacity.js` |
| `llm_capacity.vendors.claude[*].resets_at` | `account-usage` DB | `SELECT account_id, resets_at FROM account_usage_cache` JOIN 结果 |

#### 实现要点

1. **并行 Promise.all** 聚合所有数据源，单次请求 < 2s（vps-monitor 现有实现 5s timeout 为上限）
2. **fail-soft**：任一数据源抛错，对应字段填 `null`，不影响整体响应（HTTP 200）
3. **不新建表**，全用现有 DB 表 + 内存缓存
4. **docker ps** 在容器内通过 `pid:host` 可访问宿主 docker socket（与 harness-watchdog.js 同模式），失败时 `container_count: null`
5. `resets_at` 来源：从 `account_usage_cache` 表读取，不重复调用 Anthropic API

#### 注册位置

```js
// server.js — 在现有 infraStatusRoutes 注册行之后
import opsPanoramaRoutes from './src/routes/ops-panorama.js';
app.use('/api/brain/ops-panorama', opsPanoramaRoutes);
```

---

### 交付物 2：Dashboard 全景卡片

新建文件 `apps/dashboard/src/pages/live-monitor/OpsPanoramaCard.tsx`，并在 `LiveMonitorPage.tsx` 引入。

#### 卡片布局（紧凑，不遮挡现有面板）

```
┌─────────────────────────────────────────────────────────────────┐
│  执行全景                          [刷新] ·  sampled 09:26:19  │
├──────────┬──────────────┬──────────┬────────────────────────────┤
│ 任务     │ 进程         │ 资源     │ 账号余量                   │
│ 在途: 3  │ Claude: 2    │ CPU: 1.6%│ claude/account1  41% ████░ │
│ claude:1 │ 有头: 0      │ Mem: 23% │   重置 10:39               │
│ codex: 0 │ 无头: 2      │ 负载:1.18│ claude/account2 100% █████ │
│ relay容器│ Codex:  0    │          │   重置 07-27               │
│    2     │              │          │ codex: 1/5 可用            │
│          │              │          │ grok:  0/1 可用            │
└──────────┴──────────────┴──────────┴────────────────────────────┘
```

#### 技术要求

- 轮询间隔：30 秒（与 LiveMonitorPage 现有 30s 刷新对齐）
- API 调用：`fetch('/api/brain/ops-panorama')`
- 样式：复用 LiveMonitorPage 现有 dark theme inline style 体系（无新 CSS 文件）
- 账号余量用进度条，颜色：< 80% = `#34d399`（绿），80-95% = `#fbbf24`（黄），>=95% = `#f87171`（红）
- 在途任务列表最多展示 5 条（按 priority 排序），超出显示 "+N more"

#### 接入点

在 `LiveMonitorPage.tsx` 的 LEFT panel（BRAIN 区域之后）插入 `<OpsPanoramaCard />`。

---

## 三、功能需求（FR）清单

| ID | 需求 | 验收断言 |
|----|------|----------|
| FR-01 | GET /api/brain/ops-panorama 返回 HTTP 200 | `curl -s .../ops-panorama | jq .sampled_at` 非 null |
| FR-02 | tasks.in_progress_count 与 DB 实际数量一致 | `curl .../ops-panorama | jq .tasks.in_progress_count` == `curl "/tasks?status=in_progress" | jq length` |
| FR-03 | tasks.vendor_dist 正确统计 claude/codex/grok | 有 claude 任务时 `vendor_dist.claude >= 1` |
| FR-04 | relay.container_count 返回 docker relay 容器数 | docker ps 有 2 个 relay 容器时接口返回 2；docker 不可达时返回 null 而非 5xx |
| FR-05 | sessions.headed/headless 区分正确 | claude 进程有 -p flag 的计入 headless，否则 headed |
| FR-06 | host.cpu_usage_pct / mem_used_pct 返回宿主数值 | 数值在 [0,100] 范围内 |
| FR-07 | host.load_avg_1m/5m/15m 返回宿主 loadavg | 格式为数字，非 null |
| FR-08 | processes.claude_total / codex_total 正确 | ps aux 无进程时返回 0，非 null |
| FR-09 | llm_capacity.vendors.claude[*].resets_at 非 null（账号有用量时） | account1 resets_at 有值 |
| FR-10 | 单次请求 < 2000ms | curl -w "%{time_total}" 输出 < 2 |
| FR-11 | 任一数据源异常不导致 500 | 强制 docker 不可达时接口仍返回 200 含其他字段 |
| FR-12 | Dashboard 卡片每 30s 自动刷新展示全景数据 | 打开 live-monitor 页面，30s 内数据更新 |
| FR-13 | 账号余量颜色编码正确 | account2 seven_day_pct=100 显示红色进度条 |

---

## 四、非功能需求（NFR）

- **性能**：P99 < 2s（受 os.loadavg 和 docker ps 限制，超时强制 5s fallback）
- **安全**：接口只读，无副作用；不暴露账号 token
- **可观测**：接口响应含 `sampled_at`，前端显示抓取时间
- **向后兼容**：不改动现有端点签名

---

## 五、实现方案（刀划分）

### 刀 1（后端接口）
- 新建 `packages/brain/src/routes/ops-panorama.js`
- 在 `server.js` 注册 `GET /api/brain/ops-panorama`
- 单测：`packages/brain/src/routes/__tests__/ops-panorama.test.js`
  - mock 所有 OS / DB / shell 依赖
  - 验证 fail-soft（mock docker ps 抛错 → container_count: null）
  - 验证响应结构完整性

### 刀 2（Dashboard 卡片）
- 新建 `apps/dashboard/src/pages/live-monitor/OpsPanoramaCard.tsx`
- 修改 `apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx` 引入卡片
- E2E 验收：访问 `/live-monitor`，确认"执行全景"区块可见，账号余量进度条有颜色

---

## 六、Final E2E 验收断言（合同级）

```bash
# 1. 接口存在且返回正确结构
PANORAMA=$(curl -sf http://localhost:5221/api/brain/ops-panorama)
echo "$PANORAMA" | jq -e '.sampled_at' > /dev/null
echo "$PANORAMA" | jq -e '.tasks.in_progress_count >= 0' > /dev/null
echo "$PANORAMA" | jq -e '.tasks.vendor_dist.claude >= 0' > /dev/null
echo "$PANORAMA" | jq -e '.host.cpu_usage_pct >= 0 and .host.cpu_usage_pct <= 100' > /dev/null
echo "$PANORAMA" | jq -e '.llm_capacity.sentinel != null' > /dev/null
echo "$PANORAMA" | jq -e '.llm_capacity.vendors.claude.accounts | length > 0' > /dev/null

# 2. resets_at 字段存在（account1 有5h用量数据）
echo "$PANORAMA" | jq -e '.llm_capacity.vendors.claude.accounts[] | select(.name == "account1") | .resets_at != null' > /dev/null

# 3. Dashboard 卡片可见（Playwright）
# 访问 /live-monitor，断言页面含文字"执行全景"
# 断言 .ops-panorama-card 存在
# 断言 codex 账号进度条元素数量 = 5
```

---

## 七、风险与兜底

| 风险 | 处理 |
|------|------|
| docker ps 在容器内权限不足 | `container_count: null`，不抛错；参考 executor-contracts.js 同模式 |
| account-usage 429 限流 | 复用 `getLlmCapacitySnapshot` 内置 60s 缓存，不额外调 Anthropic API |
| OS loadavg 在 Docker 内返回容器值而非宿主值 | 注明为容器内 loadavg，与 vps-monitor/stats 现有行为一致 |
| 刀2 依赖刀1 接口就绪 | 刀2 用 mock data + isLoading 状态开发，刀1 完成后联调 |

---

## 八、不在本次 Sprint 范围内

- 历史趋势图（sparkline）
- 跨设备多机 panorama 聚合（仅宿主机）
- codex-usage 实时余量（当前 codex-bridge 404，复用 llm-capacity 现有 poller 即可）
- Grok 账号 resets_at（API 暂无该字段）
