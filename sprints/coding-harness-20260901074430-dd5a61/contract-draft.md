# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD 字面）

N/A — 本任务只新增说明文档，不修改或定义 HTTP 响应。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 角色白名单封闭且包含九个执行角色；Router 同时注册 `/attempt-run` 与 `/attempt-run/:attemptId`。
- `packages/brain/src/middleware/internal-auth.test.js` → `internalAuthOrLoopback` 在配置 token 后对 loopback 与远端均严格校验凭据。
- [累积 FR] 本 line 暂无历史。
- Unified Map: `[MAP_NOT_CONFIGURED]`（task payload 未提供可用的 map_scope/map_repo 字符串）；`must_run_assertions=[]`。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接说明，覆盖创建、查询、鉴权、九角色、payload 与派发失败回滚。 |
| NFR（做得多好） | 章节语义可由冻结 Vitest 与 E2E 脚本确定性检查；不改代码。 |
| Invariant（永不违反） | 不硬编码 token 值；不把宿主/远端写成免鉴权；不修改生产行为。 |
| 判定点（怎么知道） | 以生产路由 `ALLOWED_ROLES` 与 `internalAuthOrLoopback` 实现为事实源。 |
| 保质期（何时过期） | 端点、角色或鉴权实现变化时由其代码评审者同步更新本页。 |
| 死亡告警（停了谁知道） | 冻结测试或 Sprint Tests 失败即由 CI 向 PR 作者报告。 |
| 失败语义（挂了怎么办） | 缺章节、角色不精确或语义不成立时阻塞合并，不降级放行。 |
| 效果确认（已发≠已生效） | 读取最终提交中的文档，以结构化章节断言确认六类语义均存在。 |

### 判定点登记表

（本任务无外部状态推断或接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或语义断言失败 | 测试退出非零并阻塞合并 | 是 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入接口。

## Golden Path

独立小路（无父路）

[读者打开说明] → [区分 POST 创建与 GET 查询] → [按来源携带 Bearer token] → [按角色与 payload 约束派发] → [识别失败回滚终态]

### Step 1: 找到唯一中文权威说明页
**来源**: `[FROM_PRD]` — PRD「背景」「范围限定」要求在 `docs/current/` 新增一页中文说明。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 存在且包含中文标题与内容。

**验证命令**: `test -f docs/current/attempt-run-bridge-guide.md && grep -qP '[\x{4e00}-\x{9fff}]' docs/current/attempt-run-bridge-guide.md`

**硬阈值**: 文件恰位于约定路径且至少包含一个中文字符；由上述命令 exit 0 判定。

### Step 2: 区分创建与查询
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1、6 项明确 POST 用于创建、GET 用于查询。

**可观测行为**: 同一端点说明章节分别把 POST 与“创建/派发”绑定、把 GET 与“查询/轮询”绑定，而非仅罗列路径。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901074430-dd5a61/tests/attempt-run-bridge-guide.test.ts -t 'POST 明确用于创建且 GET 明确用于查询'`

**硬阈值**: 该定向测试 1/1 通过；路径或用途任一错配均 exit 非零。

### Step 3: 正确携带鉴权凭据
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 项及边界情况要求宿主、远端请求始终携带 Bearer token。

**可观测行为**: 鉴权章节写明两端点采用 `internalAuthOrLoopback`，并分别声明宿主请求和远端请求都携带 `Authorization: Bearer CECELIA_INTERNAL_TOKEN`，不得宣称任一来源免鉴权。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901074430-dd5a61/tests/attempt-run-bridge-guide.test.ts -t '鉴权明确要求宿主和远端分别携带 Bearer token'`

**硬阈值**: 该定向测试 1/1 通过；仅出现 token 字样但未分别绑定宿主/远端时失败。

### Step 4: 按白名单与 payload 约束创建 attempt
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3、4 项要求精确九角色及 payload 字段规则。

**可观测行为**: 白名单按生产顺序独立列出九项；payload 把 `sprint_dir`、`base_repo`、`branch` 分别标为必填，并说明 `base_sha` 可省略且由生产 Brain 自解析。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901074430-dd5a61/tests/attempt-run-bridge-guide.test.ts -t '角色白名单恰好|payload 区分'`

**硬阈值**: 两个定向测试 2/2 通过；角色增减、别名、字段必填性漂移均失败。

### Step 5: 识别派发失败后的完整收口
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 项要求同时说明三类关联对象终态。

**可观测行为**: 自动回滚章节明确写出 `run→failed`、`session→closed`、`task→cancelled`。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901074430-dd5a61/tests/attempt-run-bridge-guide.test.ts -t '派发失败章节同时定义'`

**硬阈值**: 该定向测试 1/1 通过，任一对象或终态缺失均失败。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、模块传递、生命周期或 DB 写路径，N/A）

## 真实调用方请求 shape

N/A — 本单不新增或修改真实调用方；文档只描述既有接口。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 接缝清单

（本单仅验证静态中文文档，不触碰外部真实世界接缝，N/A）

gp-anchor: skipped (product-map.json not found)

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web（该 docs-only Sprint 在 checkout 内执行 Bash/Vitest，不启动 UI）

```bash
#!/bin/bash
set -euo pipefail
DOC=docs/current/attempt-run-bridge-guide.md
SPRINT_DIR=sprints/coding-harness-20260901074430-dd5a61
BASE_SHA=de47c2d8b164a09ea5470eb9948ad6e8b2cf6ba1

test -f "$DOC"
grep -qP '[\x{4e00}-\x{9fff}]' "$DOC"
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts"
CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD | grep -v "^$SPRINT_DIR/" || true)
test "$CHANGED" = "$DOC"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否把 `base_sha` 误列为必填。
- 重复提交: N/A，静态文档无提交入口。
- 中途中断: N/A，静态文档无运行态。
- 边界值: 检查角色列表是否含第十项、别名或漏项。
发现分级: P0/P1（鉴权误导、角色或回滚语义错误）阻塞 merge；P2/P3 记 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 文档完整语义 | `sprints/coding-harness-20260901074430-dd5a61/tests/attempt-run-bridge-guide.test.ts` | `POST 明确用于创建且 GET 明确用于查询`；`鉴权明确要求宿主和远端分别携带 Bearer token`；`角色白名单恰好列出生产实现中的九项`；`payload 区分三个必填字段`；`派发失败章节同时定义` | 文档尚未生成，5 个测试因 ENOENT 失败 |

## Notes

- contract-gate: 使用 Cecelia 仓库现有 `packages/brain/src/lib/contract-gate.js`；合同需接受确定性门禁。
- validation identity: Evaluator/Judge 只使用 Runner 当次注入的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID`，不固化本轮 proposer 身份。
