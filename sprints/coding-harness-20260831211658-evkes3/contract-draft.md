# Sprint Contract Draft（Round 1）

## 范围与基线

- 权威实现基线：`perfectuser21/cecelia@88929fa377f5bed3cd1876a575c366ff1b93c0d5`。
- 只允许新增 `docs/current/attempt-run-bridge-guide.md`；不得修改代码、配置、数据库或其他文档。
- PRD 来源：task bundle 的 `inputs.thin_prd`（当前 checkout 无 `sprint-prd.md`）。
- contract-gate：使用 Cecelia 现有 Contract Gate；本单仅文档交付。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: N/A）

N/A — 本任务不新增或修改 HTTP 响应，只说明现有端点。

## 已知约束

- [`packages/brain/src/routes/__tests__/harness-attempt-run.test.js`] → 角色白名单封闭且恰有九项；Router 同时挂载 POST 与 GET 路径。
- [`packages/brain/src/middleware/internal-auth.test.js`] → token 已配置时所有来源必须鉴权；未配置时只允许非生产 loopback。
- context-manifest: unavailable（bundle 未提供 journey_id，无法构造 T3 请求）。
- Unified Map: `[MAP_NOT_CONFIGURED]`（task bundle 未提供 map_scope/map_repo，must_run_assertions 为空）。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文使用说明，覆盖两个端点、鉴权、九项角色、payload 与派发失败回滚。 |
| NFR（做得多好） | 单页可检索；所有名称与现有源码逐字一致。 |
| Invariant（永不违反） | 仅改 `docs/current/`；不声称改变运行行为；不得记录真实 token。 |
| 判定点（怎么知道） | 以现有路由与中间件源码为事实来源，并由冻结测试逐项检查文档。 |
| 保质期（何时过期） | 端点、白名单、鉴权或 payload 契约改变时由对应代码 PR 同步更新。 |
| 死亡告警（停了谁知道） | 冻结测试在 Sprint Tests 中失败，CI 立即告知 PR 作者。 |
| 失败语义（挂了怎么办） | 缺任一章节或事实不一致即验收失败，不发布残缺说明。 |
| 效果确认（已发≠已生效） | 测试读取最终文档并验证四类事实与范围。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或事实漂移 | CI 非零退出，阻止交付 | 是 | 不降级，不接受不完整文档 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入入口。

## Golden Path

独立小路（无父路）

读者打开说明 → 识别 POST/GET 用途与鉴权 → 按九项角色和 payload 组装请求 → 理解派发失败后的资源终态。

### Step 1：找到桥接端点与鉴权要求

**来源**: `[FROM_PRD]` — thin PRD 第 1 项。

**可观测行为**: 中文文档明确 POST 用于异步派发、GET 用于按 attempt id 轮询结构化结果；说明 `internalAuthOrLoopback`，以及宿主/远端请求必须发送 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。

**硬阈值与验证命令**: 两个完整路径、用途、中间件名、Bearer header 和环境变量名均出现。

```bash
npx vitest run --no-cache sprints/coding-harness-20260831211658-evkes3/tests/attempt-run-bridge-guide.test.ts -t '说明两个端点用途与鉴权方式'
```

### Step 2：选择合法执行角色

**来源**: `[FROM_PRD]` — thin PRD 第 2 项。

**可观测行为**: 文档逐字列出九项白名单：`canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`。

**硬阈值与验证命令**: 九项不重不漏，且明确白名单外角色返回 `role_not_allowed`。

```bash
npx vitest run --no-cache sprints/coding-harness-20260831211658-evkes3/tests/attempt-run-bridge-guide.test.ts -t '完整列出九项角色白名单'
```

### Step 3：组装派发 payload

**来源**: `[FROM_PRD]` — thin PRD 第 3 项。

**可观测行为**: 文档说明 `payload.sprint_dir`、`payload.base_repo`、`payload.branch` 必填，`payload.base_sha` 可省略并由生产 Brain 解析，同时给出无真实凭据的请求示例。

**硬阈值与验证命令**: 三个必填字段和一个可省略字段均有明确语义。

```bash
npx vitest run --no-cache sprints/coding-harness-20260831211658-evkes3/tests/attempt-run-bridge-guide.test.ts -t '说明 payload 必填字段与 base_sha 省略规则'
```

### Step 4：识别派发失败回滚终态

**来源**: `[FROM_PRD]` — thin PRD 第 4 项。

**可观测行为**: 文档明确本调用新建资源在派发抛错或非 `LAUNCHED` 时自动回滚：run → `failed`、session → `closed`、task → `cancelled`。

**硬阈值与验证命令**: 三种资源与终态逐项对应，并限定为本调用新建资源。

```bash
npx vitest run --no-cache sprints/coding-harness-20260831211658-evkes3/tests/attempt-run-bridge-guide.test.ts -t '说明派发失败自动回滚的三个终态'
```

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径的实现变更，N/A。）

## 真实调用方请求 shape

N/A — 本任务不修改调用方或服务端请求 shape；文档示例只复述现有 JSON body 与 `Authorization` header。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本单只交付静态文档，不改变真实系统接缝，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作

高风险面:
- 错输入: 检查示例是否会误导读者把 token 放进 JSON body。
- 重复提交: N/A，静态文档无提交动作。
- 中途中断: N/A，静态文档无运行过程。
- 边界值: 检查九项角色是否不重不漏、连字符是否准确。

发现分级: P0/P1（泄露凭据或错误指导生产鉴权）阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
SPRINT_DIR="sprints/coding-harness-20260831211658-evkes3"
DOC="docs/current/attempt-run-bridge-guide.md"
git diff --name-only 88929fa377f5bed3cd1876a575c366ff1b93c0d5...HEAD | awk 'NF && $0 !~ /^docs\/current\/attempt-run-bridge-guide\.md$/ && $0 !~ /^sprints\/coding-harness-20260831211658-evkes3\//' | tee /tmp/attempt-run-doc-out-of-scope.txt
test ! -s /tmp/attempt-run-doc-out-of-scope.txt
test -s "$DOC"
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts"
```

通过标准：脚本 exit 0；目标文档存在；冻结测试全部通过；实现 diff 不越出目标文档（Sprint 合同产物除外）。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260831211658-evkes3/tests/attempt-run-bridge-guide.test.ts` | 说明两个端点用途与鉴权方式；完整列出九项角色白名单；说明 payload 必填字段与 base_sha 省略规则；说明派发失败自动回滚的三个终态；实现范围仅含目标文档 | 目标文档尚不存在，测试读取文件时失败 |

