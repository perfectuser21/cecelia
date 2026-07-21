# Contract Draft — 资源动态调度加厚·续

**TASK_ID**: `b580b96e-74a5-4ce7-aabe-a776e4ac5c69`  
**SPRINT_DIR**: `sprints/07212116-relay-b580b96e`  
**日期**: `2026-07-21`

## 合同范围

本合同覆盖当前仓库里已经出现的资源动态调度续接实现，不复写旧任务 `a598772e` 的 grok relay 需求。核心验收对象是：

- [`packages/brain/src/dispatch-allocation-guide.js`](/workspace/packages/brain/src/dispatch-allocation-guide.js)
- [`packages/brain/src/llm-capacity.js`](/workspace/packages/brain/src/llm-capacity.js)
- [`packages/brain/src/dispatcher.js`](/workspace/packages/brain/src/dispatcher.js)
- [`packages/brain/src/routes/dispatch.js`](/workspace/packages/brain/src/routes/dispatch.js)

GitHub 上 PR #4133 的旧任务描述漂移不在本合同的代码验收面内；这里仅补 repo 内 sprint 产物，使其绑定当前任务 `b580b96e`。

## 行为断言

- [BEHAVIOR] `applyDispatchAllocationGuide()` 对 `harness_initiative` 生效；当 `claude.available_count=0` 且 `codex.available_count>0` 时，应产生 `selected_executor=codex` 和 `continuation_level=L3_cross_vendor_fallback` 或 `L2_primary_codex` 的真实账本字段。
- [BEHAVIOR] `chooseGuidedExecutor()` 在两家计费厂商都不可用、但 `grok.available_count>0` 时，必须返回 `executor='grok'` 与 `level='L4_grok_fallback'`。
- [BEHAVIOR] `getLlmCapacitySnapshot()` 产出的账本必须同时包含 `claude`、`codex`、`grok` 三个 vendor 摘要，并给出 `sentinel`。
- [BEHAVIOR] `dispatcher.js` 在引导员发生变更时，必须把 `payload.allocation` 持久化回 `tasks.payload`；若 selected executor 为 `codex` 或 `grok`，顶层 `provider` 也要同步。
- [BEHAVIOR] `GET /api/brain/dispatch/llm-capacity` 必须返回当前快照 JSON，不得写库、不做状态修改。
- [BEHAVIOR] 对已有显式 `payload.executor` 的任务，引导员必须 preserve override，不得覆写调用方意图。

## 关键锚点

- `DISPATCH_ALLOCATION_GUIDE_VERSION='dispatch-allocation-guide/v2'`
- `GUIDED_TASK_TYPES = new Set(['dev', 'harness_initiative'])`
- `chooseGuidedExecutor()` 的 5 个层级字符串：
  `L1_primary_claude`、`L2_primary_codex`、`L3_cross_vendor_fallback`、`L4_grok_fallback`、`L4_fail_open`
- `buildLlmCapacityHandler()` 与路由 `GET /dispatch/llm-capacity`

## Test Contract

| 合同行为 | Test File | 代码锚点 | 期望 |
|---|---|---|---|
| `harness_initiative` 纳入引导范围 | `packages/brain/src/__tests__/dispatch-allocation-guide.test.js` | `applyDispatchAllocationGuide()` | `task.payload.allocation` 含 `continuation_level` |
| 两家计费厂商不可用时走 L4 grok | `packages/brain/src/__tests__/llm-capacity.test.js` | `chooseGuidedExecutor()` | 返回 `executor='grok'` |
| dispatcher 持久化 allocation 账本 | `packages/brain/src/__tests__/dispatcher-allocation-guide.test.js` | `dispatchNextTask()` | DB `payload` update 被调用 |
| 路由返回 llm capacity 快照 | `packages/brain/src/routes/__tests__/dispatch.test.js` | `buildLlmCapacityHandler()` | `res.json()` 含 `sentinel` |
| 显式 executor override 保留 | `packages/brain/src/__tests__/dispatch-allocation-guide.test.js` | `reason='explicit_override_preserved'` | `changed=false` |

## E2E 验收

当前分支可定义的本地验收是“单测 + 只读 API”二段式，不把未实跑的真实上游调用写成已通过。

| 验收点 | 方式 | Pass 标准 |
|---|---|---|
| 引导员扩围 | 运行 `dispatch-allocation-guide.test.js` | `harness_initiative` case 通过 |
| 四级续接 | 运行 `llm-capacity.test.js` | `L4_grok_fallback` case 通过 |
| DB 账本持久化 | 运行 `dispatcher-allocation-guide.test.js` | `payload.allocation` 的 `UPDATE tasks` 断言通过 |
| 只读哨兵口 | Brain 启动后 `curl /api/brain/dispatch/llm-capacity` | 返回 JSON 且含 `sentinel`、`vendors.claude/codex/grok` |

## 未覆盖真实链路清单

- 未覆盖真实 Claude `getAccountUsage()` 在线返回，当前只有单测/注入快照级别验证。
- 未覆盖真实 Codex `wham/usage` API 在 `team1~team5` 全部本机账号上的在线返回与 token 失效分支。
- 未覆盖真实 Grok 资源枯竭后，由真实 dispatch 任务一路落到 `L4_grok_fallback` 的 live 证据。
- 未覆盖 GitHub 上 PR #4133 的 body/task-id 修正，因为本次只允许写 sprint 目录。

## manual:bash

```bash
cd /workspace/packages/brain
npm test src/__tests__/dispatch-allocation-guide.test.js src/__tests__/dispatcher-allocation-guide.test.js src/__tests__/llm-capacity.test.js src/routes/__tests__/dispatch.test.js

curl -sf http://localhost:5221/api/brain/dispatch/llm-capacity | jq '{sentinel, vendors: (.vendors | keys)}'
curl -sf "http://localhost:5221/api/brain/dispatch/recent?limit=3" | jq '{limit,total}'
```

## 交付判定

- 只要 repo 内文档明确绑定当前任务 `b580b96e`，并且上述四组测试仍能证明代码锚点存在，本合同即可进入评审。
- 真实上游 API 联调、PR #4133 GitHub 元数据修正属于后续交付动作，不得在本合同中伪装成“已由代码验证”。
