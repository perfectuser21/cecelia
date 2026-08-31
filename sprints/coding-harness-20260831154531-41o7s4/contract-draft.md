# Sprint Contract Draft (Round 1)

## 证据来源与范围

- 权威实现基线：`88929fa377f5bed3cd1876a575c366ff1b93c0d5`（跨角色与 GAN 轮次保持不变）。
- PRD 正文：task bundle 的 `thin_prd`；`sprint-prd.md` 作补充上下文。
- 生产事实：`packages/brain/src/routes/harness-attempt-run.js` 的两个路由、`ALLOWED_ROLES` 与 rollback；`packages/brain/src/middleware/internal-auth.js` 的鉴权中间件。
- Unified Map：`[MAP_NOT_CONFIGURED]`；task payload 未提供有效 `map_scope/map_repo` 组合，`must_run_assertions` 为空，不做领域猜测。
- Registry：API、DB、test registry 均可读取；本任务不新增响应或数据库结构，测试沿用 Vitest `describe/it/expect`。
- contract-gate：enabled（`packages/brain/src/lib/contract-gate.js` 存在）。
- gp-anchor：skipped (`product-map.json` not found)。

## Response Schema（推导来源: PRD字面）

N/A — 本任务只新增说明文档，不新增或修改 HTTP 响应。

## 已知约束

- `[回归测试] packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 角色白名单封闭且恰为九项；路由同时包含 `/attempt-run` 与 `/attempt-run/:attemptId`。
- `[回归测试] tests/gp/f1/step3-attempt-run-endpoint.test.js` → POST 派发、GET 投影与 dispatch 失败回滚行为已被锁定。
- `[累积FR]` 本 line 暂无历史。
- `[铁律]` 端点鉴权、凭据不落库、不写死环境、真环境接缝验证、Planner 分支约束均不因 docs-only 交付而改变；对应 DoD INV-1 至 INV-5。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增中文 attempt-run 桥接使用说明，覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 字面值可机检；不含真实 token；唯一产品改动是目标文档。 |
| Invariant（永不违反） | 不修改应用代码；不暗示远端免鉴权；不把 `base_sha` 写成必填。 |
| 判定点（怎么知道） | 以生产路由源码与既有回归测试为当前事实，以冻结 Vitest 逐节断言。 |
| 保质期（何时过期） | 端点、角色、字段或回滚状态变化时，由改动者同步更新文档及冻结测试。 |
| 死亡告警（停了谁知道） | Sprint Tests 在文档缺失或字面合同漂移时立即失败，由 PR CI 作者获知。 |
| 失败语义（挂了怎么办） | 文档任一必需节缺失即阻塞合并，不降级放行。 |
| 效果确认（已发≠已生效） | CI 从仓库真实文档读取并逐项断言，不以提交消息或文件存在 alone 判定。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或字面值错误 | Vitest 非零退出并阻塞合并 | 是，修正文档后可重复执行 | 无降级 |
| 真实 token 被写入 | 安全检查失败并阻塞合并 | 是 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入入口。

## 真实调用方请求 shape

N/A — 本任务只记录既有接口，不修改设备/agent 到服务端的调用 shape；文档请求示例仅使用 PRD 指定的鉴权头和 payload 字段。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块、生命周期或 DB 写路径，N/A）

## Golden Path

独立小路（无父路）

[阅读说明] → [识别端点与鉴权] → [选择角色并填写 payload] → [识别失败回滚]

### Step 1: 找到中文说明并理解两个端点
**来源**: `[FROM_PRD]` — thin_prd 第 1 项明确要求两个端点的用途与鉴权方式。

**可观测行为**: 读者看到独立的端点与鉴权节，明确 POST 创建并派发、GET 按 attempt id 查询；宿主/远端必须使用 Bearer token。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831154531-41o7s4/tests/attempt-run-bridge-guide.test.ts -t '端点与鉴权说明完整且远端鉴权 fail-closed'
```
**硬阈值**: 两个端点、两种用途、`internalAuthOrLoopback` 与 Bearer 占位符全部命中；命令 exit 0。

### Step 2: 从九项白名单选择角色
**来源**: `[FROM_PRD]` — thin_prd 第 2 项要求完整列出角色白名单九项；名称由生产 `ALLOWED_ROLES` 推导。

**可观测行为**: 读者看到且仅看到九项生产允许角色：`canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831154531-41o7s4/tests/attempt-run-bridge-guide.test.ts -t '角色白名单完整列出生产九项角色'
```
**硬阈值**: 代码围栏内 JSON 数组解析后恰为九项且集合精确相等；命令 exit 0。

### Step 3: 填写 payload 并保持基线权威
**来源**: `[FROM_PRD]` — thin_prd 第 3 项逐字规定三个必填字段与 `base_sha` 省略语义。

**可观测行为**: 读者明确 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略并由生产 Brain 自解析，不以调用方值替代权威基线。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831154531-41o7s4/tests/attempt-run-bridge-guide.test.ts -t 'payload 必填字段与 base_sha 省略语义准确'
```
**硬阈值**: 三个必填字段逐项命中，`base_sha` 同时命中“可省略”和“生产 Brain 自解析”；命令 exit 0。

### Step 4: 识别派发失败的完整回滚
**来源**: `[FROM_PRD]` — thin_prd 第 4 项定义三个对象及终态。

**可观测行为**: 读者看到派发失败自动收口为 `run → failed`、`session → closed`、`task → cancelled`，不会误判仍有活跃资源。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831154531-41o7s4/tests/attempt-run-bridge-guide.test.ts -t '派发失败回滚三个对象与终态完整'
```
**硬阈值**: 三条状态转换逐项命中；命令 exit 0。

## 接缝清单

本任务只写仓库文档，不执行真实 API、第三方或真机操作；无真实世界接缝，N/A。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR='sprints/coding-harness-20260831154531-41o7s4'
BASE_SHA='88929fa377f5bed3cd1876a575c366ff1b93c0d5'
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts" --reporter=verbose
CHANGED=$(git diff --name-only "$BASE_SHA" --)
UNEXPECTED=$(printf '%s\n' "$CHANGED" | grep -Ev '^(docs/current/ATTEMPT_RUN_BRIDGE_GUIDE\.md|sprints/coding-harness-20260831154531-41o7s4/)' || true)
[ -z "$UNEXPECTED" ] || { echo "FAIL: 发现范围外改动: $UNEXPECTED"; exit 1; }
printf '%s\n' "$CHANGED" | grep -qx 'docs/current/ATTEMPT_RUN_BRIDGE_GUIDE.md'
```

通过标准：冻结测试四项全绿，且相对权威基线的产品改动只有目标文档；任何断言失败均非零退出。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 搜索文档是否把远端请求描述为可免鉴权。
- 重复提交: 检查九项角色是否重复、遗漏或混入非白名单角色。
- 中途中断: N/A，静态文档无进行中状态。
- 边界值: 检查 `base_sha` 是否被误写为必填或可替代权威基线。
发现分级: P0/P1（泄露 token、远端免鉴权误导）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接使用说明 | `sprints/coding-harness-20260831154531-41o7s4/tests/attempt-run-bridge-guide.test.ts` | `端点与鉴权说明完整且远端鉴权 fail-closed`；`角色白名单完整列出生产九项角色`；`payload 必填字段与 base_sha 省略语义准确`；`派发失败回滚三个对象与终态完整` | 目标文档尚不存在，4 tests failed |
