# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A）

N/A — 本任务仅新增说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [`packages/brain/src/routes/__tests__/harness-attempt-run.test.js`] → 路由同时注册 POST 与 GET。
- [`tests/gp/f1/step3-attempt-run-endpoint.test.js`] → 白名单、必填项、派发失败回滚及结果轮询行为已由生产测试锁定。
- context-manifest: unavailable（任务未提供 journey_id）。
- Unified Map: `[MAP_NOT_CONFIGURED]`（任务未提供 map_scope/map_repo）。

## 八要素需求规范

| 要素 | 本次答案 |
|------|----------|
| FR（做什么） | 新增一页中文 attempt-run 桥接使用说明，覆盖 PRD 四类信息。 |
| NFR（做得多好） | 文档中的端点、字段、九项角色及回滚终态须可由冻结测试逐字核对。 |
| Invariant（永不违反） | 只改 sprint 合同产物和 `docs/current/` 目标文档，不修改代码。 |
| 判定点（怎么知道） | Vitest 读取目标文档并断言全部必要事实。 |
| 保质期（何时过期） | 路由协议变化时由对应代码变更同步更新文档。 |
| 死亡告警（停了谁知道） | Sprint Tests/CI 在文档缺失或关键内容漂移时失败。 |
| 失败语义（挂了怎么办） | 任一必要事实缺失即阻塞验收，不降级放行。 |
| 效果确认（已发≠已生效） | 以提交树中的中文文档及冻结测试通过为准。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 文档不存在或缺少必要事实 | Vitest 非零退出并阻塞验收 | 是 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入入口。

gp-anchor: skipped (product-map.json not found)

contract-gate: applicable（`packages/brain/src/lib/contract-gate.js` 存在）。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、模块接缝或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 本任务不改变调用协议；文档按既有生产路由说明 Bearer 鉴权与 payload 字段。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## Golden Path

独立小路（无父路）

[读者找到说明页] → [按鉴权与 payload 发起 POST] → [使用 attempt_id 轮询 GET] → [理解失败回滚语义]

### Step 1: 找到两个桥接端点及鉴权说明
**来源**: `[FROM_PRD]` — thin PRD 第 1 项。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 用中文说明 POST 派发、GET 轮询，以及 `internalAuthOrLoopback` 和远端 Bearer token 要求。

**验证命令**: `npx vitest run sprints/coding-harness-20260831021639-oqz7bs/tests/attempt-run-bridge-guide.test.ts -t '说明两个端点用途与鉴权'`

**硬阈值**: 两个端点、鉴权中间件名、Bearer token 变量全部命中，命令 exit 0。

### Step 2: 选择合法角色并构造 payload
**来源**: `[FROM_PRD]` — thin PRD 第 2、3 项。

**可观测行为**: 文档逐字列出九项角色，并明确 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略且由生产 Brain 自解析。

**验证命令**: `npx vitest run sprints/coding-harness-20260831021639-oqz7bs/tests/attempt-run-bridge-guide.test.ts -t '列出九项角色白名单' -t '说明 payload 必填字段与 base_sha 省略语义'`

**硬阈值**: 九个角色无遗漏，四个字段语义准确，命令 exit 0。

### Step 3: 理解派发失败后的资源终态
**来源**: `[FROM_PRD]` — thin PRD 第 4 项。

**可观测行为**: 文档明确派发失败自动回滚为 run→failed、session→closed、task→cancelled。

**验证命令**: `npx vitest run sprints/coding-harness-20260831021639-oqz7bs/tests/attempt-run-bridge-guide.test.ts -t '说明派发失败的三项自动回滚'`

**硬阈值**: 三类资源与终态一一对应，命令 exit 0。

### Step 4: 防止实现范围蔓延
**来源**: `[AI_ADDED]` — 将 PRD 的“不改任何代码”转为可机检边界，防止文档任务误改生产代码。

**可观测行为**: 交付提交除 sprint 合同产物外只新增 `docs/current/attempt-run-bridge-guide.md`。

**验证命令**: `bash -c 'git diff --name-only 1ef19bd6f70b79e14a20ecb0e37ba8492f71a029...HEAD | grep -Ev "^(docs/current/attempt-run-bridge-guide.md|sprints/coding-harness-20260831021639-oqz7bs/)" | (! grep .)'`

**硬阈值**: 禁止出现生产代码路径，命令 exit 0。

## E2E 验收

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
npx vitest run sprints/coding-harness-20260831021639-oqz7bs/tests/attempt-run-bridge-guide.test.ts --reporter=verbose
git diff --name-only 1ef19bd6f70b79e14a20ecb0e37ba8492f71a029...HEAD | grep -Ev '^(docs/current/attempt-run-bridge-guide.md|sprints/coding-harness-20260831021639-oqz7bs/)' | (! grep .)
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明文档 | `sprints/coding-harness-20260831021639-oqz7bs/tests/attempt-run-bridge-guide.test.ts` | `说明两个端点用途与鉴权`；`列出九项角色白名单`；`说明 payload 必填字段与 base_sha 省略语义`；`说明派发失败的三项自动回滚` | 目标文档尚不存在，4 tests failed |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例是否误把 `base_sha` 写成必填。
- 重复提交: 检查九项角色是否重复或遗漏。
- 中途中断: N/A，静态文档无异步流程。
- 边界值: 检查宿主/远端与 loopback 鉴权边界是否表达清楚。
发现分级: P0/P1 → 阻塞 merge；P2/P3 → 记 findings 不阻塞。
