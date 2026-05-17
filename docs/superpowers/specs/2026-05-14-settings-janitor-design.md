# Settings 控制中心 + Janitor 维护模块 — 设计文档

**日期**: 2026-05-14  
**任务**: 630ded36-1d82-4015-865f-5d839a4867a8  
**分支**: cp-0514085250-janitor-walking-skeleton

---

## 背景与问题

当前 SettingsPage 只有两个孤立 toggle（意识开关、飞书静默），系统级维护任务（zombie-cleaner、task-cleanup、docker-prune 等）散落在各模块、无法从前端感知或控制。磁盘因 Docker 镜像积累爆满（127GB）是直接触发点。

---

## 目标

1. SettingsPage 改为**带左侧导航的 4-tab 容器**，成为所有系统配置的统一入口
2. 新建 **Janitor 维护模块**（Brain 侧），统一调度所有维护任务，DB 记录执行历史
3. "维护" tab 做成完整 E2E（API + DB + UI），其余 3 个 tab 为可导航的 stub
4. Docker 清理作为第一个 Janitor 任务，接入 brain-build.sh 自动触发

---

## 架构

```
SettingsPage (容器)
├── BrainSystemTab        ← 现有两个 toggle 搬入（逻辑不变）
├── MaintenanceTab        ← 全新 E2E（本次 walking skeleton 核心）
├── NotificationsTab      ← stub（空壳）
└── AccountsTab           ← stub（空壳）

Brain 侧
├── janitor.js            ← 新模块，注册/调度所有 JanitorJob
├── janitor-jobs/
│   ├── docker-prune.js   ← Docker image/container 清理
│   └── (后续: disk-monitor, worktree-cleanup, log-rotation)
└── API: GET/POST /api/brain/janitor/*

DB
└── janitor_runs 表       ← 记录每次任务执行结果
```

---

## 数据模型

### `janitor_runs` 表

```sql
CREATE TABLE janitor_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      TEXT NOT NULL,        -- 'docker-prune' | 'disk-monitor' | ...
  job_name    TEXT NOT NULL,        -- 显示名
  status      TEXT NOT NULL,        -- 'success' | 'failed' | 'skipped'
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  output      TEXT,                 -- 简短输出摘要
  freed_bytes BIGINT                -- 可选，Docker清理专用
);
```

### `janitor_config` 表（简单 KV）

```sql
CREATE TABLE janitor_config (
  job_id      TEXT PRIMARY KEY,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  schedule    TEXT,                 -- cron 表达式，NULL = 手动触发
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Brain API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/brain/janitor/jobs` | 返回所有注册的 job + 最近一次运行状态 |
| POST | `/api/brain/janitor/jobs/:id/run` | 立即触发某个 job |
| PATCH | `/api/brain/janitor/jobs/:id/config` | 开关 + 修改 schedule |
| GET  | `/api/brain/janitor/jobs/:id/history?limit=20` | 执行历史 |

---

## Frontend — SettingsPage 改造

### 路由结构

```
/settings                → 重定向到 /settings/brain
/settings/brain          → BrainSystemTab
/settings/maintenance    → MaintenanceTab
/settings/notifications  → NotificationsTab (stub)
/settings/accounts       → AccountsTab (stub)
```

### 布局

```
┌─────────────────────────────────────────────────────┐
│  设置                                                │
├──────────────┬──────────────────────────────────────┤
│  Brain 系统   │  维护任务                             │
│  维护    ←●  │                                      │
│  通知         │  Docker 清理    [●开]  上次: 今天8:52 │
│  账户         │  [立即执行]  [查看历史 ↓]             │
│              │                                      │
│              │  磁盘监控       [○关]  —              │
│              │  Worktree清理   [●开]  上次: 昨天      │
│              │  日志轮转       [●开]  上次: 3天前     │
└──────────────┴──────────────────────────────────────┘
```

### 组件结构

```
SettingsPage.tsx         ← 改为左导航容器（React Router outlet）
├── SettingsNav.tsx      ← 左侧 4 项导航
├── BrainSystemTab.tsx   ← 迁移现有两个 toggle
├── MaintenanceTab.tsx   ← Janitor E2E 页面
│   ├── JanitorJobCard.tsx   ← 单个 job 卡片（名称/开关/上次运行/立即执行）
│   └── JanitorRunHistory.tsx ← 展开式执行历史列表
├── NotificationsTab.tsx ← stub: "即将推出"
└── AccountsTab.tsx      ← stub: "即将推出"
```

---

## Docker 清理 Job 逻辑

```js
// janitor-jobs/docker-prune.js
async function run() {
  // 1. docker image prune -f  (只删 dangling，不删 tagged)
  // 2. docker container prune -f
  // 3. 记录释放字节数 → janitor_runs.freed_bytes
  // 触发方式: 1) janitor.js 每天 02:00 自动跑; 2) brain-build.sh 每次 build 后触发
}
```

**brain-build.sh 集成**：build 完成后追加：
```bash
curl -s -X POST localhost:5221/api/brain/janitor/jobs/docker-prune/run
```

---

## 测试策略

| 类型 | 内容 |
|------|------|
| Unit | `janitor.js` job 注册/调度逻辑；`docker-prune.js` 命令构造 |
| Integration | POST `/run` → DB 写入 janitor_runs → GET `/jobs` 返回最新状态 |
| E2E smoke | `packages/brain/scripts/smoke/janitor-smoke.sh`：curl POST run → 等2s → curl GET jobs 验 status=success |

---

## Walking Skeleton 交付范围（本次 PR）

### 包含
- [ ] DB migration: `janitor_runs` + `janitor_config` 表
- [ ] `packages/brain/src/janitor.js` + `janitor-jobs/docker-prune.js`
- [ ] Brain API 4 个端点
- [ ] SettingsPage 改为左导航容器
- [ ] MaintenanceTab E2E（含 JanitorJobCard + 立即执行 + 简单历史）
- [ ] BrainSystemTab（现有两个 toggle 迁入）
- [ ] NotificationsTab / AccountsTab stub
- [ ] brain-build.sh 加 docker-prune 触发
- [ ] smoke.sh + integration test

### 不包含（后续迭代）
- 磁盘监控 job（需要 macOS API）
- Worktree 清理 job
- 日志轮转 job
- 定时 cron 表达式编辑 UI
- Notion 同步
