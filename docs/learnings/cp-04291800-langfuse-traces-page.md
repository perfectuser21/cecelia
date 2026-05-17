## Langfuse Traces 中台页面 — 把 Reporter 一边写、Dashboard 一边看不见的断链补上（2026-04-29）

### 任务概述

主理人当前最大开发痛点："看不到现在在干什么"。今日对话调研后发现：Cecelia 的 `langfuse-reporter.js` 已经把每次 LLM 调用上报到自托管 Langfuse（`http://100.86.118.99:3000`），共积累 105,470 条 trace（最新 1 分钟前），但 Cecelia Dashboard 从未把这些数据展示出来。本 PR 加 `GET /api/brain/langfuse/recent` 中台代理 + `/traces` 页面，把这条断链补完。

### 根本原因（为什么会出现这个断链）

1. **入口契约没保护 trace 流入中台**：Reporter 是 LLM 调用层 hook，写入是自动的；但 Dashboard 是手工组装的页面集合，没人显式拉这些数据。两边各自完工，中间没契约。
2. **行业模式相同**：搜了 LangChain / LangSmith / Cursor / Devin / Backlog.md 等十几个 AI-native 工具，发现"agent 行为观测"和"数据状态/回填"是两个独立的产品方向，几乎没人把它们融合到主理人的中台 dashboard。
3. **不是工具缺，是 orchestration 没接通**：105K 条数据躺着 = 配置完整 + 代码完整 + 知识缺位。

### 下次预防 checklist

- [ ] **新增上报机制时同步加中台展示路径**：任何 reporter / writer 类代码进入 cecelia/zenithjoy 时，PRD 必须显式列出"中台怎么 surface"这一项，不允许只有写入半边
- [ ] **凭据已存在 ≠ 已接通**：搜 `~/.credentials/*.env` 看到文件别假设服务接通了，必须 `isEnabled() === true` 测试一次 + 数据库/外服务实际查一次
- [ ] **整合 path：Reporter pattern → API 代理 → Dashboard**：成熟模式（这次实施验证了）—— Reporter 不暴露给前端，必须经过 backend route 二次封装（凭据安全 + fail-soft），前端只调中台 path
- [ ] **测试 mock 边界注意 fetch self-pollution**：`vi.spyOn(global, 'fetch')` 配合 `await fetch(http://localhost:PORT)` 调起 express server 会污染（spy 会拦截自己的请求） — integration test 必须用 supertest 走 node:http 直连
- [ ] **fail-soft is critical for proxy routes**：代理外部服务的 backend route 必须 try/catch 全包，HTTP 仍返 200 + body `{success:false, error}`，避免外服务挂了前端白屏

### 技术细节（供后续参考）

- 凭据加载：内联 `loadConfig()` 复制 `langfuse-reporter.js:21-39` 同样逻辑（v1 不重构 helper，零回归）
- Langfuse trace 详情 URL pattern：`${LANGFUSE_BASE_URL}/trace/${traceId}`（无 projectId 也工作）
- AbortSignal.timeout(5000) 对 fetch 有效（Node 18+ 内置）
- Cecelia hook `branch-protect.sh` 检测 `.dev-mode.<branch>` 标记，没这个文件任何 Write 都被拦——必须先走 `/dev` 才能写代码
- system feature manifest（`apps/api/features/system/index.ts`）是 Dashboard nav 的 SSOT，加新页面 = routes + components 各加一行

### 下一步（v2 范围，本 PR 不做）

- LangGraph workflow 级 trace 上报（每个 graph 节点 → Langfuse generation/span）—— 需要给 4 个 graph 文件（harness-initiative / harness-gan / harness-task / dev-task / pipeline graph.py）加 callback handler
- run_events 表整合（现在 0 条数据，先让 organ 写入再说）
- 过滤 / 搜索 / 分页 / cost 聚合视图

PR：https://github.com/perfectuser21/cecelia/pull/2690
