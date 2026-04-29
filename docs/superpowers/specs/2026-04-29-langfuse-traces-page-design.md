# Langfuse Traces Page (中台 /traces) — 设计 Spec

**日期**：2026-04-29
**分支**：`cp-04291800-langfuse-traces-page`
**Worktree**：`/Users/administrator/worktrees/cecelia/langfuse-traces-page`
**主理人原始诉求**："开发过程中看不到现在在干什么"

---

## 一、问题陈述

Cecelia 系统中，`packages/brain/src/langfuse-reporter.js` 已经把每次 LLM 调用上报到自托管 Langfuse（`http://100.86.118.99:3000`），目前累积 ~105K 条 trace。但 Cecelia Dashboard 从未把这些数据展示出来——Reporter 一边写，主理人一边看不见。

本任务：在 Dashboard 加 `/traces` 页面，把 Langfuse 数据**显式 surface 到中台**。

**不解决的问题**（明确）：
- 不显示 LangGraph workflow 级 trace（v2）
- 不接 `run_events` 表（当前 0 条数据，无价值）
- 不修改 `langfuse-reporter.js` 现有上报逻辑
- 不动 `LiveMonitorPage.tsx`（1700 行高风险）

---

## 二、架构

```
[Cecelia Dashboard]                  [Brain]                     [Langfuse]
 /traces page  ──── GET ──→  /api/brain/langfuse/recent ──→  /api/public/traces
                                  (Basic Auth from
                                   ~/.credentials/langfuse.env)
```

**为什么走中台代理而非前端直连 Langfuse**：
1. Langfuse 凭据不能进前端 bundle
2. Tailscale IP（`100.86.118.99:3000`）只在内网可达，前端可能跑在不同网络上
3. 未来可在中台层加缓存 / 聚合

---

## 三、Backend 详细设计

### 文件：`packages/brain/src/routes/langfuse.js`

```
GET /api/brain/langfuse/recent
  Query:
    limit?: number  (default 20, max 100)
  Response 200:
    成功: { success: true, data: [Trace], count: number }
    失败: { success: false, data: [], error: string }   ← fail-soft，不抛 500
```

`Trace` 字段（从 Langfuse `/api/public/traces` 透传 + 精简）：
- `id` (string)
- `name` (string) — 例如 `llm-call-cortex`
- `timestamp` (ISO string)
- `latencyMs` (number, optional — 来自 generation 子项的 latency)
- `model` (string, optional)
- `metadata` (object, optional — 透传 metadata)
- `langfuseUrl` (string) — 拼好的详情链接：`${LANGFUSE_BASE_URL}/trace/${id}`（Langfuse 公开 trace 详情页 URL pattern，无需 projectId）

**凭据加载**：在 `langfuse.js` 内联一个本地 `loadConfig()`（复制 `langfuse-reporter.js` 第 21-39 行的相同逻辑，~15 行）。**不**重构 reporter 也**不**抽 shared helper —— 保持 v1 改动最小化、零回归。后续 v2 若再加路由可考虑抽 helper。

**错误处理**（fail-soft）：
- Langfuse 不可达 / 超时（5s）→ 返回 `{success:false, data:[], error:'langfuse_unreachable'}`
- 凭据加载失败 → 返回 `{success:false, data:[], error:'credentials_missing'}`
- Auth 失败（401/403）→ 返回 `{success:false, data:[], error:'auth_failed'}`
- 其他 → 返回 `{success:false, data:[], error:err.message}`

### 文件：`packages/brain/server.js` (修改)

在已有 `import traceRoutes` 附近加：
```js
import langfuseRoutes from './src/routes/langfuse.js';
// ...
app.use('/api/brain/langfuse', langfuseRoutes);
```

---

## 四、Frontend 详细设计

### 文件：`apps/api/features/system/pages/TracesPage.tsx`

**布局**：单页表格 + 顶部状态栏 + 30s polling

**状态栏**：`Last updated: HH:MM:SS  ·  N traces  ·  [Refresh]`

**表格列**：
| 列 | 字段 | 渲染 |
|---|---|---|
| Time | timestamp | `MM-DD HH:MM:SS` |
| Name | name | 文本 + 单色 chip |
| Model | model | 灰色小字 |
| Latency | latencyMs | `XXXms` 或 `X.Xs` |
| — | langfuseUrl | "查看详情 ↗" 外链 |

**空态**：`"暂无 trace。请检查 Langfuse 服务: http://100.86.118.99:3000"`

**错误态**：banner 显示 `error` 字段，不阻止显示空表

### 文件：`apps/api/features/system/index.ts` (修改)

在 routes 数组末尾追加：
```ts
{
  path: '/traces',
  component: 'TracesPage',
  navItem: { label: 'Traces', icon: 'Activity', group: 'system', order: 6 },
},
```

components 末尾追加：
```ts
TracesPage: () => import('./pages/TracesPage'),
```

---

## 五、测试策略

按 Cecelia 测试金字塔分层：

| 层级 | 类型 | 文件 | 验证内容 |
|------|------|------|---------|
| **真服务跨进程** | smoke (E2E) | `packages/brain/scripts/smoke/langfuse-recent-smoke.sh` | 真起的 brain + curl，验证 200 + body 含 `success` + `data` |
| **路由 handler 行为** | integration | `packages/brain/src/routes/__tests__/langfuse.test.js` | mock `fetch`，验证 fail-soft 行为（凭据缺失 / Langfuse 超时 / 401）+ limit 上限 + 字段映射 |
| **Page 渲染** | unit | `apps/api/features/system/pages/__tests__/TracesPage.test.tsx` | mock `fetch` 返回固定数据，验证表头存在 + 一行渲染正确 + 错误态展示 banner |

**理由分类**：
- smoke 跨进程跨网络 → E2E
- 路由 handler 跨多模块（fetch + 凭据加载 + handler 逻辑） → integration
- Page 单组件渲染 → unit

---

## 六、TDD Commit 顺序

**commit-1 (Red)**：
- `packages/brain/scripts/smoke/langfuse-recent-smoke.sh`（脚本完整，但 brain 没挂路由 → curl 404 失败）
- `packages/brain/src/routes/__tests__/langfuse.test.js`（import 不存在的 `langfuse.js` → 失败）
- `apps/api/features/system/pages/__tests__/TracesPage.test.tsx`（import 不存在的 `TracesPage` → 失败）

**commit-2 (Green)**：
- 实现 `packages/brain/src/routes/langfuse.js`
- 修改 `packages/brain/server.js` 挂载路由
- 实现 `apps/api/features/system/pages/TracesPage.tsx`
- 修改 `apps/api/features/system/index.ts` 注册

**TDD 顺序由 CI `lint-tdd-commit-order` 强制**。

---

## 七、依赖与环境

- **新依赖**：无（`fetch` 已内置 Node 18+）
- **凭据**：复用现有 `~/.credentials/langfuse.env`，**不新建凭据**
- **环境变量**：无新增
- **数据库迁移**：无
- **Docker mount**：现有 `cecelia-node-brain` 已 mount `/Users/administrator/.credentials/`，无需改

---

## 八、回滚计划

如果上线后出现问题：
1. 注释掉 `server.js` 里的 `app.use('/api/brain/langfuse', ...)` → 路由失效，不影响其他功能
2. 注释掉 `system/index.ts` 里的 `/traces` 路由项 → 页面 nav 隐藏
3. 文件可保留，下次再改

零数据库变更 → 零回滚风险。

---

## 九、DoD（验收标准）

1. PR CI 全绿（含 `lint-tdd-commit-order` + `lint-feature-has-smoke` + 单测 + smoke real-env-smoke job）
2. 容器内 `bash packages/brain/scripts/smoke/langfuse-recent-smoke.sh` PASS
3. 浏览器 `http://perfect21:5211/traces` 看到最近 50 条 trace
4. 表格里 "查看详情" 链接能跳到 `http://100.86.118.99:3000/project/.../traces/<id>`
5. 模拟 Langfuse 不可达（停服务或断网）后页面显示错误 banner，不白屏

---

## 十、范围外（明确不做）

- 过滤 / 搜索 / 分页（v1 = 列表 + 跳转）
- 实时 WebSocket 推送（v1 = 30s polling）
- LangGraph workflow 级 trace 整合（需要改 langfuse-reporter.js + 各 graph，是独立任务）
- Cost / token 聚合视图（v2）
- 接 `run_events` 表（数据为空，无意义）
- 修改 `LiveMonitorPage.tsx`（高风险大文件）
