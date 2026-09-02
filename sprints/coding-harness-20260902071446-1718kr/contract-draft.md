# Sprint Contract Draft (Round 3)

## Response Schema（推导来源: PRD字面）

N/A — 本任务只新增使用说明文档，不修改或调用 HTTP API。

## 技术与证据来源

- 权威实现：`packages/brain/src/routes/harness-attempt-run.js` 的路由、`ALLOWED_ROLES`、payload 校验和 rollback 更新语句。
- 鉴权实现：`packages/brain/src/middleware/internal-auth.js` 的 `internalAuthOrLoopback`。
- Registry：api/db/test registry 均为空，文档事实以 PRD和当前实现字面为准 `[NEW_PATTERN]`。
- Unified Map：`[MAP_NOT_CONFIGURED]`（task payload 未提供可用 map_scope/map_repo）；无 `must_run_assertions`。
- implementation baseline：`7a156f791feca8815bfabfbadce2ad874acf02af`。PRD E2E 注释中的旧 SHA 不作为本轮基线。
- context-manifest：journey_id 为 `none`，无可查询的累积 FR；PRD 明示本 line 暂无历史。
- gp-anchor: skipped (product-map.json not found)

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 路由必须同时注册 `/attempt-run` 与 `/attempt-run/:attemptId`。
- `packages/brain/src/middleware/internal-auth.test.js` → token 配置后严格验 Bearer；无 token 时仅非生产 loopback 放行。
- `[累积FR]` 本 line 暂无历史。

## Golden Path

独立小路（无父路）

[打开中文说明] → [理解 POST 创建运行] → [理解 GET 查询状态与鉴权] → [按封闭角色和 payload 构造请求] → [识别失败回滚终态]

### Step 1: 按 POST 端点创建运行
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 项。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 在「端点用途与鉴权」章节明确 `POST /api/brain/harness/attempt-run` 用于创建运行。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t 'POST /api/brain/harness/attempt-run 用于创建运行'
```
**硬阈值**: 指定测试 1/1 通过；POST 未与“创建运行”建立同一行语义关联时非零退出。

### Step 2: 按 GET 端点查询状态并遵守鉴权边界
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1、2 项及「边界情况」。

**可观测行为**: 同一章节明确 `GET /api/brain/harness/attempt-run/:id` 用于查询状态；中文正文说明两端点使用 `internalAuthOrLoopback`，宿主/远端须携带 Bearer token 占位符且不暴露令牌值。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t 'GET /api/brain/harness/attempt-run/:id 用于查询状态|两个端点说明 internalAuthOrLoopback 鉴权边界'
```
**硬阈值**: 指定测试 2/2 通过；GET 未与“查询状态”建立同一行语义关联，或缺鉴权名称、Bearer 占位符、中文正文时非零退出。

### Step 3: 查阅九项角色白名单
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项；角色字面值来自当前生产实现 `ALLOWED_ROLES`。

**可观测行为**: 「角色白名单」章节用编号列表精确列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，不使用“等”或开放式措辞。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t '角色白名单使用封闭枚举且恰好列出九项角色'
```
**硬阈值**: 实际数组与上述九项按顺序完全相等，长度只能为 9，开放式措辞必须失败。

### Step 4: 按 payload 字段约束构造请求
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项。

**可观测行为**: 文档将 `sprint_dir`、`base_repo`、`branch` 标为必填；将 `base_sha` 标为可省略且由生产 Brain 自解析，不写固定 SHA。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t 'payload 精确区分三个必填字段与可省略 base_sha'
```
**硬阈值**: 三个必填字段逐项命中；`base_sha` 同一行同时含可省略语义和生产 Brain 自解析语义，且不得标为必填。

### Step 5: 识别派发失败的完整回滚结果
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 项。

**可观测行为**: 「派发失败自动回滚」章节同时出现 `run→failed`、`session→closed`、`task→cancelled`，三者缺一不可。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t '派发失败回滚同时给出 run session task 三个终态'
```
**硬阈值**: 三个终态在同一章节全部命中，任一缺失即非零退出。

### Step 6: 保持 documentation-only 精确范围
**来源**: `[AI_ADDED]` — 将 PRD「不改任何代码」和唯一允许文件约束转换为不可被额外改动绕过的基线 diff oracle。

**可观测行为**: 排除本 sprint 的冻结合同产物后，相对权威 implementation baseline 只新增 `docs/current/attempt-run-bridge-guide.md`，无其他文件变化。

**验证命令**:
```bash
BASE=7a156f791feca8815bfabfbadce2ad874acf02af; ACTUAL=$(git diff --name-status "$BASE"...HEAD -- . ":(exclude)sprints/coding-harness-20260902071446-1718kr/**"); [ "$ACTUAL" = $'A\tdocs/current/attempt-run-bridge-guide.md' ]
```
**硬阈值**: 过滤后的 name-status 输出必须逐字等于单行 `A<TAB>docs/current/attempt-run-bridge-guide.md`。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 本 sprint 不发请求、不改调用方，仅记录 PRD 指定的端点、鉴权和 payload 使用契约。

## 未覆盖真实链路清单

（本合同无 mock 豁免，且 PRD 明确禁止真实 attempt-run 派发，N/A。）

## 接缝清单

（纯文档交付，无真机、第三方、异步或 DB 接缝，N/A。）

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接说明，覆盖 PRD 四节。 |
| NFR（做得多好） | 四节可由冻结 Vitest 逐项解析，范围由精确 diff oracle 封闭。 |
| Invariant（永不违反） | 不泄露 token；不改代码；不把 loopback 例外扩到远端；不写死 base_sha。 |
| 判定点（怎么知道） | 见下方登记表。 |
| 保质期（何时过期） | 随端点实现和角色枚举变更而过期；后续修改实现者负责同步文档。 |
| 死亡告警（停了谁知道） | Sprint Tests 的冻结文档测试失败并阻塞 CI。 |
| 失败语义（挂了怎么办） | 任一内容或范围 oracle 失败即阻塞交付，不降级放行。 |
| 效果确认（已发≠已生效） | 对提交树运行冻结测试并核对基线 diff；不执行真实派发。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节、枚举不精确或范围越界 | 测试非零退出并阻塞交付 | 是，修正文档后重跑 | 无降级 |

### 输入对抗面

N/A — 不对外暴露 agent 或新增输入入口。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例是否误把 `base_sha` 写成必填或固定值。
- 重复提交: 检查九项角色是否重复、缺项或出现“等”式开放枚举。
- 中途中断: N/A，静态文档无异步流程。
- 边界值: 检查远端鉴权与 loopback 例外是否被混写。
发现分级: P0/P1（泄密、误导远端鉴权或错误回滚语义）阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=7a156f791feca8815bfabfbadce2ad874acf02af
SPRINT_DIR=sprints/coding-harness-20260902071446-1718kr
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts"
ACTUAL=$(git diff --name-status "$BASE_SHA"...HEAD -- . ":(exclude)$SPRINT_DIR/**")
EXPECTED=$'A\tdocs/current/attempt-run-bridge-guide.md'
[ "$ACTUAL" = "$EXPECTED" ] || { echo "FAIL: 范围越界或目标文档并非新增，实际=$ACTUAL"; exit 1; }
echo 'OK: 中文说明内容与 documentation-only 精确范围均通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| POST 创建用途 | `sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts` | POST /api/brain/harness/attempt-run 用于创建运行 | 文档尚不存在，读取抛出 ENOENT |
| GET 查询用途 | `sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts` | GET /api/brain/harness/attempt-run/:id 用于查询状态 | 文档尚不存在，读取抛出 ENOENT |
| 鉴权边界 | `sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts` | 两个端点说明 internalAuthOrLoopback 鉴权边界 | 文档尚不存在，读取抛出 ENOENT |
| 封闭角色枚举 | `sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts` | 角色白名单使用封闭枚举且恰好列出九项角色 | 文档尚不存在，读取抛出 ENOENT |
| payload 约束 | `sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts` | payload 精确区分三个必填字段与可省略 base_sha | 文档尚不存在，读取抛出 ENOENT |
| 回滚终态 | `sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts` | 派发失败回滚同时给出 run session task 三个终态 | 文档尚不存在，读取抛出 ENOENT |
