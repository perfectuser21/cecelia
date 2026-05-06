# Harness Graph RetryPolicy + final_evaluate Interrupt (W2 + W5)

**分支**: cp-05062124-w2-w5-graph-retry-interrupt
**Spec**: `docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md` §W2 §W5
**Plan**: `docs/superpowers/plans/2026-05-06-harness-langgraph-reliability.md` §W2 §W5

## 背景 / 问题

LangGraph 1.2.9 提供 5 件可靠性原语，Cecelia harness graph 当前未启用其中两件：

1. **节点级 RetryPolicy 全空** — 任何瞬时错（503/timeout/network blip）就让整 initiative 失败
2. **关键决策点无 interrupt()** — final E2E 重试 3 次仍失败时直接 silent END，主理人不知，需手撕 SQL 才能介入

本 PR 同时上这两件，是 spec §W2 + §W5 的最小可独立合并切片。

## 成功标准

- [x] [BEHAVIOR] retry-policies.js 三个 policy 导出存在 — Test: tests/integration/harness-retry-policy.test.ts
- [x] [BEHAVIOR] graph 节点配 retryPolicy — Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('retryPolicy: LLM_RETRY')||!c.includes('retryPolicy: DB_RETRY')||!c.includes('retryPolicy: NO_RETRY'))process.exit(1)"
- [x] [BEHAVIOR] final_evaluate 在 fix_round>=3 时调 interrupt — Test: tests/integration/harness-interrupt-resume.test.ts
- [x] [BEHAVIOR] /api/brain/harness-interrupts 路由可访问 — Test: tests/integration/harness-interrupt-resume.test.ts
- [x] [ARTIFACT] retry-policies.js 文件存在 — Test: manual:node -e "require('fs').accessSync('packages/brain/src/workflows/retry-policies.js')"
- [x] [ARTIFACT] harness-interrupts.js 路由文件存在 — Test: manual:node -e "require('fs').accessSync('packages/brain/src/routes/harness-interrupts.js')"

## 范围限定

**在范围内**：
- 新建 `packages/brain/src/workflows/retry-policies.js`
- 改 `packages/brain/src/workflows/harness-initiative.graph.js`：14+5 个 addNode 加 retryPolicy；finalEvaluateDispatchNode 加 interrupt()
- 新建 `packages/brain/src/routes/harness-interrupts.js`
- 改 `packages/brain/server.js` 注册新路由
- 集成测试 2 个

**不在范围内**：
- thread_id 版本化（W1，独立 PR）
- AbortSignal + watchdog（W3，独立 PR）
- invoke→stream 改造 + Dashboard LiveMonitor（W4，独立 PR）
- docker-executor OOM Promise reject（W6，独立 PR）
- 运维清单 W7.x（独立 PR）

## 受影响文件

- `packages/brain/src/workflows/retry-policies.js` (new)
- `packages/brain/src/routes/harness-interrupts.js` (new)
- `packages/brain/src/workflows/harness-initiative.graph.js`
- `packages/brain/server.js`
- `tests/integration/harness-retry-policy.test.ts` (new)
- `tests/integration/harness-interrupt-resume.test.ts` (new)

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| LLM_RETRY retryOn 误判永久错为瞬时（账号锁死） | retryOn 函数 PERMANENT_ERROR_RE 严格白名单，单测覆盖 401/403/schema/parse 全部不重试 |
| interrupt() 主理人不响应 → graph 永久挂起 | 24h 后视同 abort（待 W5 后续 PR 加超时机制；本 PR 仅打通通路） |
| Command 用法在 LangGraph 1.2.9 行为变更 | LangGraph 1.2.9 是 spec 锁定版本，PostgresSaver 已支持 Command resume |
| 路由依赖 task_events 表（W4 创建） | 路由 GET 失败不阻塞业务；POST 写 task_events 失败仅 warn 不阻断 resume |

## 部署后验证

合并 + Brain 重启后：
1. `curl localhost:5221/api/brain/harness-interrupts` → 返回 `{"interrupts":[]}`（或既有未 resume 列表）
2. `psql -d cecelia -c "SELECT 1"` 之外不需要 schema 改动
