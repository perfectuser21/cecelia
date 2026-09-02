# Sprint Contract Draft (Round 1)

## 合同基线与范围

- authoritative implementation baseline: `7a156f791feca8815bfabfbadce2ad874acf02af`
- 唯一生产交付物：`docs/current/attempt-run-bridge-guide.md`（新增）
- 禁止修改代码、配置、API 行为、数据结构或既有文档；不真实派发 attempt。
- `[MAP_NOT_CONFIGURED]`：任务未提供 `map_scope/map_repo`，不回退到领域硬编码。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: 生产路由实现）

文档必须用语义 oracle 说明既有端点响应，但本 sprint 不改变响应结构。

### Endpoint: POST /api/brain/harness/attempt-run

**Success (HTTP 202)**：必含 `status="LAUNCHED"`、`run_id`、`attempt_id`、`role`，可含 `lease_owner`。文档示例必须使用 `jq -e` 同时校验 HTTP 202、状态与非空 ID，不能只展示 curl。

### Endpoint: GET /api/brain/harness/attempt-run/:id

**Success (HTTP 200)**：返回 attempt 投影；文档轮询示例必须校验响应 `id` 等于 POST 的 `attempt_id`，并仅在 `completed|completed_with_concerns|failed|cancelled|blocked|needs_context` 终态停止；404 的 `error="attempt_not_found"` 必须作为失败而非成功。

**禁用字段名**：N/A（PRD 未定义新 schema，本 sprint 不改 API）。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 角色白名单封闭，恰有九项角色，且不含 commander/publisher。
- `packages/brain/src/middleware/internal-auth.test.js` → `internalAuthOrLoopback` 区分 loopback 与非 loopback 请求。
- `[累积FR]` 本 line 暂无历史。
- context-manifest: N/A（PRD 的 journey_id 为 none）。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文说明，覆盖 POST/GET、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 四节信息完整；POST/GET 示例有可执行语义 oracle；唯一生产文件。 |
| Invariant（永不违反） | 不泄露 token；不把 loopback 豁免扩展至宿主/远端；不改代码。 |
| 判定点（怎么知道） | 由冻结 Vitest 与 E2E 文本/结构断言判断。 |
| 保质期（何时过期） | 路由鉴权、角色、字段或状态语义变化时由该路由维护者同步更新。 |
| 死亡告警（停了谁知道） | Sprint Tests/合同 E2E 在文档缺节、漂移或误写时失败。 |
| 失败语义（挂了怎么办） | 文档断言 fail-closed；任何缺项均阻塞交付，不执行真实派发。 |
| 效果确认（已发≠已生效） | 对候选树中的新文档运行冻结测试，并验证相对基线的文件差异。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺少任一必要语义 | 测试非零退出并阻塞 | 是 | 无降级 |
| 真实 Brain 不可用 | 不调用、不派发 | N/A | 以生产源码与冻结测试作权威来源 |

### 输入对抗面

N/A（仅静态内部文档，不新增对外 agent 或输入接口）。

## 真实调用方请求 shape

本 sprint 不创建或修改调用方。文档示例须保持生产同形：宿主/远端使用 HTTP `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`；POST 使用 `Content-Type: application/json`，body 顶层含 `role`、`title`、`payload`，其中 payload 写 `sprint_dir`、`base_repo`、`branch`，`base_sha` 可省略。GET 使用 POST 返回的 `attempt_id` 作为路径参数，不在 body 传 ID。

## 未覆盖真实链路清单

- 真实 attempt 派发｜PRD 明确禁止真实派发，且交付仅为文档｜由既有路由集成测试负责生产行为；本 sprint 用源码同形语义 oracle 与冻结文档测试防漂移。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、模块接缝或 DB 写路径，N/A。）

## Golden Path

独立小路（无父路）

[打开说明] → [理解并构造 POST] → [按 attempt_id 轮询 GET] → [识别派发失败回滚]

### Step 1: 打开中文桥接说明
**来源**: `[FROM_PRD]` — PRD「Golden Path」与「范围限定」。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 是中文页面，且有四个约定章节。

**验证命令**:
```bash
test -f docs/current/attempt-run-bridge-guide.md && grep -q 'attempt-run 桥接使用说明' docs/current/attempt-run-bridge-guide.md
```
**硬阈值**: 文件存在、标题命中；上述命令 exit 0。

### Step 2: 按文档构造 POST 创建请求
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1-4 项。

**可观测行为**: 调用方能区分 loopback/远端鉴权，逐项选择九角色之一，并按必填 payload 构造请求；示例以 HTTP 202、`LAUNCHED`、非空 IDs 为成功 oracle。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t 'POST 创建与 GET 状态查询给出可执行语义 oracle|鉴权区分 loopback 与宿主远端且不泄露令牌|角色白名单逐项列出九项角色|payload 必填三字段且 base_sha 可省略由生产 Brain 自解析'
```
**硬阈值**: 4 个定向测试全部通过；命令 exit 0。

### Step 3: 使用 GET 查询状态并识别终态
**来源**: `[FROM_PRD]` — PRD Golden Path 的 GET 查询与最终状态要求。

**可观测行为**: 文档轮询 POST 返回的 `attempt_id`，校验 GET 的 `id`，明确终态集合，404 不得作为成功。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t 'POST 创建与 GET 状态查询给出可执行语义 oracle'
```
**硬阈值**: 定向测试通过；命令 exit 0。

### Step 4: 识别派发失败后的三个回滚终态
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 项与边界情况。

**可观测行为**: 同一章节同时呈现 `run→failed`、`session→closed`、`task→cancelled`。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t '派发失败回滚同时说明 run session task 三个终态'
```
**硬阈值**: 定向测试通过；命令 exit 0。

### Step 5: 锁定 docs-only 变更边界
**来源**: `[AI_ADDED]` — 防止实现者借文档任务修改生产代码或既有文档。

**可观测行为**: 相对权威 implementation baseline，仅合同产物、冻结测试与唯一新生产文档发生变化；生产交付差异只有该文档。

**验证命令**:
```bash
BASE=7a156f791feca8815bfabfbadce2ad874acf02af; git diff --name-only "$BASE" -- docs/current packages apps | sort | diff -u <(printf '%s\n' docs/current/attempt-run-bridge-guide.md) -
```
**硬阈值**: `docs/current packages apps` 范围的差异集合严格等于唯一新文档；命令 exit 0。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否把 GET 路径参数误写成 run_id 或 body 字段。
- 重复提交: 检查九角色是否重复列项而造成“九行但不唯一”。
- 中途中断: 检查轮询遇到 404/500 时是否被误述为成功终态。
- 边界值: 检查 `base_sha` 省略语义是否误写为固定 SHA 或客户端自行猜测。
发现分级: P0/P1（泄密、错误鉴权、错误派发语义）阻塞 merge；P2/P3 记 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web（仅在工作区机械验证文档；不启动浏览器、不派发 attempt）

```bash
#!/usr/bin/env bash
set -euo pipefail
BASE=7a156f791feca8815bfabfbadce2ad874acf02af
DOC=docs/current/attempt-run-bridge-guide.md
TEST=sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts
test -f "$DOC"
npx vitest run --no-cache "$TEST"
git diff --name-only "$BASE" -- docs/current packages apps | sort | diff -u <(printf '%s\n' "$DOC") -
node -e 'const fs=require("fs");const s=fs.readFileSync(process.argv[1],"utf8");if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)' "$DOC"
echo 'attempt-run 文档合同验收通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 端点用途与 oracle | `sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts` | POST 创建与 GET 状态查询给出可执行语义 oracle | 文档未实现时 readFileSync ENOENT |
| 鉴权 | `sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts` | 鉴权区分 loopback 与宿主远端且不泄露令牌 | 文档未实现时 readFileSync ENOENT |
| 九角色 | `sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts` | 角色白名单逐项列出九项角色 | 文档未实现时 readFileSync ENOENT |
| payload | `sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts` | payload 必填三字段且 base_sha 可省略由生产 Brain 自解析 | 文档未实现时 readFileSync ENOENT |
| 回滚 | `sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts` | 派发失败回滚同时说明 run session task 三个终态 | 文档未实现时 readFileSync ENOENT |
