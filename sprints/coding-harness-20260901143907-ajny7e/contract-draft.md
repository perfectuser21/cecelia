# Sprint Contract Draft (Round 1)

## 基线与范围

- authoritative implementation baseline: `perfectuser21/cecelia@5d25dcd6addb8ba30c742281b682589a3b95eaab`（来自 task bundle `inputs.implementation_baseline`；不以 role checkout 或 PRD 内旧 SHA 替换）。
- 唯一产品交付文件：`docs/current/attempt-run-bridge-guide.md`。
- 不修改代码、接口、鉴权、角色白名单、数据库结构或运行行为。
- `[MAP_NOT_CONFIGURED]`：task payload 未提供 `map_scope`/`map_repo`，无 `must_run_assertions`。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists).
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: N/A）

N/A — 本 Sprint 仅新增使用说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [`packages/brain/src/routes/harness-attempt-run.js` @ implementation baseline] `ALLOWED_ROLES` 精确包含九项；POST/GET 都挂载 `internalAuthOrLoopback`。
- [`packages/brain/src/middleware/internal-auth.test.js`] loopback 与配置 token 后的鉴权行为已有回归约束；文档不得把 loopback 例外扩写为远端免鉴权。
- [累积 FR] context-manifest 未随 bundle 提供且本角色无运行中 Brain 资源，记为 `context-manifest: unavailable`。
- PRD 中实现 SHA `559921...` 与 task bundle 权威基线冲突；按角色合同采用 `5d25dcd...`，不得将 checkout SHA 当成另一来源替换它（本轮二者恰好相同）。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文说明，覆盖两个端点、鉴权、九项角色、payload 与失败回滚。 |
| NFR（做得多好） | 四个主题无遗漏；角色名与权威实现逐字一致；不得出现真实 token。 |
| Invariant（永不违反） | 唯一产品文件位于 `docs/current/`，不改代码；不混用或泄露凭据；实现基线固定。 |
| 判定点（怎么知道） | 由冻结 Vitest 对文档内容作可执行断言，见 Test Contract。 |
| 保质期（何时过期） | 白名单、鉴权或 payload 契约变更时由对应实现 PR 同步更新本文。 |
| 死亡告警（停了谁知道） | Sprint Tests 在文档缺失或关键契约漂移时失败并通知 PR 作者。 |
| 失败语义（挂了怎么办） | 任一必要章节或精确值缺失即 fail-closed，禁止批准合同交付。 |
| 效果确认（已发≠已生效） | 从 Git HEAD 读取真实文档并执行五个内容断言；仅文件存在不算通过。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或章节不完整 | 测试非零退出，阻塞交付 | 是，补正文后重跑 | 无降级，不接受部分说明 |
| 权威实现与文档角色名不一致 | 测试非零退出，阻塞交付 | 是 | 以冻结实现基线为准修正文档 |

### 输入对抗面

N/A — 本 Sprint 不新增对外 agent 或输入面。

## Golden Path

独立小路（无父路）

[阅读说明] → [理解端点] → [正确鉴权] → [构造合法 payload/role] → [识别失败回滚]

### Step 1: 找到中文说明并理解两个端点
**来源**: `[FROM_PRD]` — “Golden Path”第 1 项与范围限定。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 为中文，分别说明 POST 发起和 GET 查询用途。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t '文档为中文且分别说明 POST 发起与 GET 查询用途'
```
**硬阈值**: 目标测试 1/1 通过，exit code = 0。

### Step 2: 区分 loopback 与宿主/远端鉴权
**来源**: `[FROM_PRD]` — “Golden Path”第 2 项与边界情况。

**可观测行为**: 读者看到 `internalAuthOrLoopback`，且宿主/远端必须发送 `Bearer CECELIA_INTERNAL_TOKEN`；正文不含真实 token。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t '鉴权节区分 loopback 与宿主远端 Bearer 要求且不泄露令牌'
```
**硬阈值**: 目标测试 1/1 通过，exit code = 0。

### Step 3: 选择受支持角色
**来源**: `[FROM_PRD]` — “Golden Path”第 3 项。

**可观测行为**: 文档逐项列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，并声明白名单外角色不支持。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t '角色白名单完整列出九项且明确白名单外不支持'
```
**硬阈值**: 九项逐字命中且仅计得 9 项，目标测试 1/1 通过。

### Step 4: 构造 payload
**来源**: `[FROM_PRD]` — “Golden Path”第 4 项。

**可观测行为**: 文档标明 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略并由生产 Brain 自解析。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t 'payload 节声明三个必填字段及 base_sha 生产自解析'
```
**硬阈值**: 三项必填与一项可省略语义同时命中，目标测试 1/1 通过。

### Step 5: 识别派发失败回滚出口
**来源**: `[FROM_PRD]` — “Golden Path”第 5 项。

**可观测行为**: 文档完整展示 `run→failed/session→closed/task→cancelled`，不遗漏资源收口。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t '派发失败节完整说明 run session task 的回滚终态和顺序'
```
**硬阈值**: 精确回滚链命中，目标测试 1/1 通过。

## 真实调用方请求 shape

N/A — 本 Sprint 不改调用方或服务端请求 shape；正文只解释既有接口，不以合同构造请求替代真实实现。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本单只验证版本化文档内容，无真实世界接缝，N/A。）

## 已知回归约束映射

- PRD 注入的 area 历史铁律均不触及本次唯一产品文件，统一映射为 N/A；仍保留与本 Sprint 直接相关的三项不变量：权威基线不漂移、凭据不泄露、冻结测试必须进入 commit。
- Unified Map `must_run_assertions`：N/A（map 未配置）。

## E2E 验收

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
test "$(git rev-parse HEAD^{tree})" != ""
npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts --reporter=verbose
git diff --name-only 5d25dcd6addb8ba30c742281b682589a3b95eaab...HEAD -- docs/current/ | grep -qx 'docs/current/attempt-run-bridge-guide.md'
if git diff --name-only 5d25dcd6addb8ba30c742281b682589a3b95eaab...HEAD -- packages apps scripts | grep -q .; then
  echo 'FAIL: 文档-only Sprint 修改了代码路径'
  exit 1
fi
```

通过标准：冻结测试 5/5 通过；相对权威实现基线，`docs/current/` 唯一变更为目标说明页，代码路径无变更。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误把白名单外 role 描述为可用。
- 重复提交: N/A（静态文档）。
- 中途中断: N/A（静态文档）。
- 边界值: 检查 `base_sha` 是否被误写为必填，或将 loopback 例外扩张到远端。
发现分级: P0/P1（泄密或导致远端错误免鉴权）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 中文说明与端点用途 | `sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts` | 文档为中文且分别说明 POST 发起与 GET 查询用途 | 目标文档不存在，readFileSync 抛 ENOENT |
| 鉴权 | `sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts` | 鉴权节区分 loopback 与宿主远端 Bearer 要求且不泄露令牌 | 目标文档不存在，readFileSync 抛 ENOENT |
| 九项角色 | `sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts` | 角色白名单完整列出九项且明确白名单外不支持 | 目标文档不存在，readFileSync 抛 ENOENT |
| payload | `sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts` | payload 节声明三个必填字段及 base_sha 生产自解析 | 目标文档不存在，readFileSync 抛 ENOENT |
| 失败回滚 | `sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts` | 派发失败节完整说明 run session task 的回滚终态和顺序 | 目标文档不存在，readFileSync 抛 ENOENT |
