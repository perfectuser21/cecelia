# Sprint Contract Draft (Round 1)

## 基线与范围

- 权威实现基线：`perfectuser21/cecelia@5d25dcd6addb8ba30c742281b682589a3b95eaab`（来自 `inputs.implementation_baseline`；不以角色 checkout SHA 替换）。
- 唯一生产交付物：`docs/current/attempt-run-bridge-guide.md`。
- 实现范围只允许新增上述中文文档，不修改代码、接口、测试、数据库或运行行为。
- Unified Map：`[MAP_NOT_CONFIGURED]`，task payload 未提供 `map_scope/map_repo`；`must_run_assertions=[]`，无可加载 freshness/fact revisions。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD字面）

N/A — 本 Sprint 只新增使用说明，不定义或修改 HTTP 响应。文档中的端点行为以权威实现基线为事实来源，不扩写响应 schema。

## 已知约束

- `[packages/brain/src/routes/__tests__/harness-attempt-run.test.js]` → 角色白名单封闭：包含九个执行角色，永不包含 commander/publisher。
- `[packages/brain/src/routes/harness-attempt-run.js]` → POST 异步派发、GET 轮询结构化结果，均挂载 `internalAuthOrLoopback`。
- `[累积FR]` 本 line 暂无历史行为。
- `context-manifest: unavailable`（bundle 未提供可查询的 journey_id）。
- 铁律映射：本 Sprint 不触及运行代码、调度、状态机、数据库、租户、凭据签发或 CI；对应运行类铁律均 N/A。适用铁律为“凭据安全”“端点鉴权”：文档不得写入真实 token，并须准确说明现有鉴权边界；由 B-03、B-07 锁定。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文说明，覆盖端点用途、鉴权、九项角色、payload 字段和失败回滚。 |
| NFR（做得多好） | 内容逐字对应权威实现基线；七项冻结测试全部通过。 |
| Invariant（永不违反） | 只新增目标文档；不泄露 token；不把远端写成免鉴权。 |
| 判定点（怎么知道） | 由冻结 Vitest 对独立章节、精确角色列表与状态链做结构化断言。 |
| 保质期（何时过期） | 服务端端点、白名单或鉴权契约变化时，维护者同步更新本文档。 |
| 死亡告警（停了谁知道） | 文档漂移由 Sprint Tests/冻结合同测试失败暴露给 PR 作者与 CI。 |
| 失败语义（挂了怎么办） | 任一必需章节、字段或精确值缺失即测试非零退出并阻塞交付。 |
| 效果确认（已发≠已生效） | 读取实际文档并逐项断言，不以文件存在或自述 PASS 代替。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或内容漂移 | Vitest 非零退出，阻塞交付 | 是 | 无降级，不允许残缺文档通过 |
| 服务端事实与 PRD 冲突 | 以 implementation baseline 为准并上报合同复核 | 是 | 不猜测、不发明别名 |

### 输入对抗面

N/A — 本 Sprint 不新增对外 agent 或输入处理面。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 文档描述既有 HTTP 面但本 Sprint 不修改设备/agent 调用 shape；只锁定 PRD 指定的端点、鉴权和 payload 字段。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## Golden Path

独立小路（无父路）

[阅读说明] → [按鉴权发起 POST] → [用 GET 查询] → [识别派发结果或完整回滚]

### Step 1: 找到中文桥接说明
**来源**: `[FROM_PRD]` — “在 docs/current/ 下新增一页《attempt-run 桥接使用说明》”。

**可观测行为**: 读者在固定路径看到中文标题与中文正文。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t '标题为 attempt-run 桥接使用说明且正文包含中文'`

**硬阈值**: 标题精确匹配且至少含一个中文字符；以上命令 exit 0。

### Step 2: 理解两个端点与鉴权边界
**来源**: `[FROM_PRD]` — Golden Path 第 1-2 项。

**可观测行为**: 文档分别将 POST 说明为发起/派发、GET 说明为查询/轮询，并区分 loopback 与宿主/远端 Bearer 要求。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t '两个端点分别说明发起与查询用途|鉴权章节区分 loopback'`

**硬阈值**: 两项测试均通过；远端要求必须出现 `Bearer CECELIA_INTERNAL_TOKEN`。

### Step 3: 按白名单与 payload 发起
**来源**: `[FROM_PRD]` — Golden Path 第 3-4 项。

**可观测行为**: 文档恰好列出 `canary/planner/proposer/reviewer/generator/generator-fix/evaluator/evaluator-evidence-repair/judge` 九项，并标明三个必填 payload 字段及可省略的 `base_sha`。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t '角色白名单恰好|payload 必填字段章节'`

**硬阈值**: 九项顺序和名称精确一致；`sprint_dir/base_repo/branch` 均标为必填，`base_sha` 标为由生产 Brain 自解析。

### Step 4: 识别失败回滚出口
**来源**: `[FROM_PRD]` — Golden Path 第 5 项。

**可观测行为**: 读者能从独立章节看到完整有序链 `run→failed/session→closed/task→cancelled`。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t '派发失败自动回滚章节'`

**硬阈值**: 精确状态链出现且测试 exit 0。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web（按 PRD 显式路由；本任务无 UI，验证真相形态为仓库文档内容）

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA="5d25dcd6addb8ba30c742281b682589a3b95eaab"
GUIDE="docs/current/attempt-run-bridge-guide.md"
TEST="sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts"
npx vitest run --no-cache "$TEST" --reporter=verbose
CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD -- docs/current/)
[ "$CHANGED" = "$GUIDE" ] || { echo "FAIL: docs/current 交付范围不唯一: $CHANGED"; exit 1; }
git diff --diff-filter=AM --name-only "$BASE_SHA"...HEAD -- packages apps | grep -q . && { echo "FAIL: 发现代码变更"; exit 1; } || true
echo "OK: 中文说明七项契约与范围验证通过"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误把 `base_sha` 列为必填。
- 重复提交: 检查同一角色是否重复列出从而伪装成九项。
- 中途中断: N/A，静态文档无中断态。
- 边界值: 检查远端鉴权说明是否被 loopback 例外弱化。
发现分级: P0/P1（泄密或远端免鉴权误导）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 中文标题与端点 | `sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts` | `标题为 attempt-run 桥接使用说明且正文包含中文`、`两个端点分别说明发起与查询用途` | 目标文档尚不存在，readFileSync 抛 ENOENT |
| 鉴权、白名单与 payload | `sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts` | `鉴权章节区分 loopback`、`角色白名单恰好`、`payload 必填字段章节` | 目标文档尚不存在，测试失败 |
| 回滚与凭据安全 | `sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts` | `派发失败自动回滚章节`、`示例不得泄露真实 internal token` | 目标文档尚不存在，测试失败 |
