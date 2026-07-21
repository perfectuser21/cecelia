# Contract DoD — 资源动态调度加厚·续

**TASK_ID**: `b580b96e-74a5-4ce7-aabe-a776e4ac5c69`  
**SPRINT_DIR**: `sprints/07212116-relay-b580b96e`  
**日期**: `2026-07-21`

## DoD 清单

### 文档绑定

- [x] 新 sprint 目录使用当前任务短 id：`sprints/07212116-relay-b580b96e`
- [x] PRD / 合同文档统一绑定 `b580b96e-74a5-4ce7-aabe-a776e4ac5c69`
- [x] 文档不再把当前任务描述成旧任务 `a598772e` 的 grok relay 续写
- [x] PR #4133 的 GitHub 侧旧 body 漂移被显式记录为“仓库外动作”，未在 repo 内伪装成已完成

### 代码锚点

- [x] [`packages/brain/src/dispatch-allocation-guide.js`](/workspace/packages/brain/src/dispatch-allocation-guide.js) 已升级到 `dispatch-allocation-guide/v2`
- [x] `GUIDED_TASK_TYPES` 已包含 `harness_initiative`
- [x] [`packages/brain/src/llm-capacity.js`](/workspace/packages/brain/src/llm-capacity.js) 已提供三家 poller、容量摘要与 `sentinel`
- [x] [`packages/brain/src/dispatcher.js`](/workspace/packages/brain/src/dispatcher.js) 已在调度前读取容量快照并持久化 `payload.allocation`
- [x] [`packages/brain/src/routes/dispatch.js`](/workspace/packages/brain/src/routes/dispatch.js) 已提供 `GET /dispatch/llm-capacity`

### [BEHAVIOR] 验收项

- [x] [BEHAVIOR] `harness_initiative` 与 `dev` 一样纳入引导范围，而不是继续停留在旧版只导 `dev`。
- [x] [BEHAVIOR] `chooseGuidedExecutor()` 已存在四级续接语义：`L1` / `L2` / `L3` / `L4_grok_fallback`。
- [x] [BEHAVIOR] `llm_capacity` 快照对 `grok` 只做只读 auth presence 探针，不写 token、不碰 `refresh_token`。
- [x] [BEHAVIOR] `dispatcher.js` 在引导结果有变时会把 `payload.allocation` 写回 `tasks.payload`。
- [x] [BEHAVIOR] `GET /api/brain/dispatch/llm-capacity` 是只读 JSON 诊断口。
- [x] [BEHAVIOR] 显式 `payload.executor` override 仍被 preserve。

## Test Contract

| 合同行为 | Test File | 当前证据 | 状态 |
|---|---|---|---|
| 引导员扩围到 `harness_initiative` | `packages/brain/src/__tests__/dispatch-allocation-guide.test.js` | 包含 `harness_initiative 纳入引导范围` 用例 | 已通过 `2026-07-21` |
| 四级续接 L4 grok fallback | `packages/brain/src/__tests__/llm-capacity.test.js` | 包含 `tight + 两家计费厂商都不可用` 用例 | 已通过 `2026-07-21` |
| dispatcher 持久化 allocation 账本 | `packages/brain/src/__tests__/dispatcher-allocation-guide.test.js` | 校验 `UPDATE tasks ... payload` | 已通过 `2026-07-21` |
| 只读容量口返回快照 | `packages/brain/src/routes/__tests__/dispatch.test.js` | `buildLlmCapacityHandler()` 断言 `sentinel` | 已通过 `2026-07-21` |
| 显式 override 保留 | `packages/brain/src/__tests__/dispatch-allocation-guide.test.js` | `explicit_override_preserved` 用例 | 已通过 `2026-07-21` |

## E2E 验收

| 验收点 | 命令/方式 | 当前状态 |
|---|---|---|
| 关键单测成组通过 | 运行 4 个相关 test files | 已通过 `15/15 tests` |
| 只读容量口可访问 | `curl /api/brain/dispatch/llm-capacity` | 未实跑 |
| recent dispatch 诊断口仍可访问 | `curl /api/brain/dispatch/recent` | 未实跑 |
| 真实上游容量联调 | Claude/Codex/Grok 在线调用 | 未覆盖 |

## 未覆盖真实链路清单

- 未抓到真实 Brain 进程运行中的 `/api/brain/dispatch/llm-capacity` 响应样本。
- 未抓到真实 Codex `wham/usage` 返回、HTTP 非 200、access token 过期等 live 分支。
- 未抓到真实 Claude `getAccountUsage()` 返回异常后 `sentinel=degraded` 的 live 样本。
- 未抓到真实 `harness_initiative` 在两家计费厂商耗尽时被 dispatcher 选成 `grok` 的运行证据。
- 未修正 GitHub 上 PR #4133 的旧 task id / 旧 body。

## manual:bash

```bash
cd /workspace/packages/brain
npm test src/__tests__/dispatch-allocation-guide.test.js src/__tests__/dispatcher-allocation-guide.test.js src/__tests__/llm-capacity.test.js src/routes/__tests__/dispatch.test.js

curl -sf http://localhost:5221/api/brain/dispatch/llm-capacity | jq '{sentinel, vendors}'
curl -sf "http://localhost:5221/api/brain/dispatch/recent?limit=5" | jq '{limit,total}'
```

## DoD 结论

- 当前 repo 代码锚点已经覆盖刀1、刀3、刀4的核心实现语义。
- 当前 sprint 文档已把这些实现重新绑定到 `b580b96e`，并把刀0中“PR 元数据仍旧漂移”的部分明确标为未在 repo 内完成。
- 代码侧相关单测已于 `2026-07-21` 实跑通过；仍未升级为“全链已通过”的部分，只剩运行中 Brain API 抓证与真实上游容量联调。
