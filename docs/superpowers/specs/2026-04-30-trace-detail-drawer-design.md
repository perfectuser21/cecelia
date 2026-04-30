# Trace 详情侧边抽屉 — Design Spec

**日期**: 2026-04-30  
**分支**: cp-0430122955-trace-detail-drawer

## 问题

「查看详情」跳转 Langfuse 外部 UI 需要 Tailscale + 单独登录，体验差。

## 方案

### Backend：`packages/brain/src/routes/langfuse.js`

新增路由 `GET /trace/:id`：

```
并行调用 Langfuse Public API：
  - GET /api/public/traces/:id        → trace 基本信息 + input/output
  - GET /api/public/observations?traceId=:id&limit=50 → spans 列表
返回 { success: true, data: { trace, observations } }
fail-soft：出错返 { success: false, data: null, error: '...' }
```

复用现有 `loadConfig()` + `Authorization: Basic base64(pk:sk)` + `AbortSignal.timeout(5000)` 模式。

### Frontend：`apps/api/features/system/pages/TracesPage.tsx`

- 新增 `selectedTraceId` state（`string | null`，默认 null）
- 「查看详情」改为 `<button>` → `setSelectedTraceId(t.id)`
- 右侧 fixed drawer（宽 480px，z-50，overflow-y-auto）：
  - Header：trace name + X 关闭按钮
  - 展示：Time / Model / Latency / Input / Output / Observations 列表
  - fetch `/api/brain/langfuse/trace/${selectedTraceId}`（selectedTraceId 变化时触发）
  - loading/error 状态处理

## 测试策略

- `langfuse.js` 新路由（跨网络 I/O）→ **integration test**（supertest + `vi.spyOn(global, 'fetch')` mock，复用现有 `_setConfigForTesting` 机制）
  - 测试：成功路径 / Langfuse 不可达 / 凭据缺失
- `TracesPage.tsx` drawer → trivial UI，现有 test file 加 typeof 检查
- smoke.sh（feat: 改动 `brain/src/`）→ 必须：`curl /api/brain/langfuse/trace/:id` 验证 success 字段
