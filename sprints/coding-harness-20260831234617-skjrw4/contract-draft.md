# Sprint Contract Draft (Round 1)

## 范围与基线

- 权威实现基线：`perfectuser21/cecelia@88929fa377f5bed3cd1876a575c366ff1b93c0d5`。
- 仅允许新增 `docs/current/attempt-run-bridge-guide.md`；不得修改任何生产代码、配置或既有文档。
- PRD 来源：bundle `inputs.thin_prd`；checkout 中无 `sprint-prd.md`，不自行扩展范围。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- `[MAP_NOT_CONFIGURED]`：任务未提供 map_scope/map_repo；无 must_run_assertions。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: N/A — 仅文档变更）

N/A — 本 sprint 不新增或修改 HTTP 响应；文档只描述既有端点。

## 已知约束（来自回归测试）

- [`packages/brain/src/routes/__tests__/harness-attempt-run.test.js`] → `ALLOWED_ROLES` 冻结且恰为九项；路由包含 `/attempt-run` 与 `/attempt-run/:attemptId`。
- [`packages/brain/src/middleware/internal-auth.test.js`] → 有 token 时 loopback 也必须 Bearer；无 token 时仅 loopback 放行。
- [`packages/brain/src/routes/harness-attempt-run.js`] → 非 `LAUNCHED` 或 dispatch 抛错时，新建资源回滚为 run failed、session closed、task cancelled。
- [累积FR] context-manifest: unavailable（未提供 journey_id，无法形成端点坐标）。

## 锚定父路声明

独立小路（无父路）——仅补充既有 attempt-run 桥接端点的使用说明。

## Golden Path

[读者打开说明页] → [识别端点与鉴权] → [按九项白名单和 payload 规则构造请求] → [理解派发失败的资源终态]

### Step 1: 找到两个桥接端点及鉴权方式
**来源**: `[FROM_PRD]` — thin_prd 第 1 项。

**可观测行为**: 中文文档明确 POST 用于异步派发单角色 attempt，GET 用 attempt id 轮询结构化结果；注明 `internalAuthOrLoopback`，宿主或远端请求带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。

**验证命令**: `npx vitest run sprints/coding-harness-20260831234617-skjrw4/tests/attempt-run-bridge-doc.test.ts -t "文档说明两个端点用途与 internalAuthOrLoopback 鉴权" --no-cache`

**硬阈值**: 指定用例 1 passed，退出码 0。

### Step 2: 读取角色白名单九项
**来源**: `[FROM_PRD]` — thin_prd 第 2 项；九项字面值由生产 `ALLOWED_ROLES` 核实。

**可观测行为**: 文档逐项列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，无“等”字样替代完整枚举。

**验证命令**: `npx vitest run sprints/coding-harness-20260831234617-skjrw4/tests/attempt-run-bridge-doc.test.ts -t "文档逐项列出九个角色白名单" --no-cache`

**硬阈值**: 九项全部命中，指定用例 1 passed，退出码 0。

### Step 3: 按 payload 规则准备派发输入
**来源**: `[FROM_PRD]` — thin_prd 第 3 项。

**可观测行为**: 文档把 `sprint_dir`、`base_repo`、`branch` 标为必填，并明确 `base_sha` 可省略、由生产 Brain 自解析。

**验证命令**: `npx vitest run sprints/coding-harness-20260831234617-skjrw4/tests/attempt-run-bridge-doc.test.ts -t "文档说明 payload 三个必填字段与 base_sha 省略语义" --no-cache`

**硬阈值**: 字段与省略语义全部命中，指定用例 1 passed，退出码 0。

### Step 4: 理解派发失败自动回滚
**来源**: `[FROM_PRD]` — thin_prd 第 4 项。

**可观测行为**: 文档明确仅本次新建的桥接资源自动收口为 `run → failed`、`session → closed`、`task → cancelled`。

**验证命令**: `npx vitest run sprints/coding-harness-20260831234617-skjrw4/tests/attempt-run-bridge-doc.test.ts -t "文档说明派发失败后的三项自动回滚终态" --no-cache`

**硬阈值**: 三项终态全部命中，指定用例 1 passed，退出码 0。

## 真实调用方请求 shape

文档示例必须保持生产形状：POST JSON 顶层含 `role`、`title`、`payload`；认证使用 `Authorization` header，值为 `Bearer $CECELIA_INTERNAL_TOKEN`，不得把 token 放入 body；payload 字段使用 `sprint_dir`、`base_repo`、`branch`、可选 `base_sha`。GET 路径参数使用 POST 返回的 `attempt_id`。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）冻结测试直接读取最终文档，不 mock 文件系统。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）PRD 明确只验文档，不派发真实 attempt。

## 接缝清单

（纯文档交付，无需真目标接缝，N/A。）

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文说明，覆盖端点、鉴权、九角色、payload 和失败回滚四节 |
| NFR（做得多好） | 机械测试四项全绿；角色和字段使用生产字面值 |
| Invariant（永不违反） | 仅新增目标文档；不修改任何代码；不写入凭据值 |
| 判定点（怎么知道） | 见下表 |
| 保质期（何时过期） | 随既有 attempt-run API；角色或请求 shape 变化时由对应代码变更维护者同步更新 |
| 死亡告警（停了谁知道） | Sprint Tests 与文档范围检查在 CI 失败并阻塞合并 |
| 失败语义（挂了怎么办） | 缺任一节或发生范围外修改即验收失败，不降级放行 |
| 效果确认（已发≠已生效） | 冻结测试从最终文档读取四类内容，全部断言通过才算生效 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或术语漂移 | 测试非零退出并阻塞 | 是 | 无降级 |
| 出现 docs/current 目标文档外的实现改动 | 范围检查失败 | 是 | 回到单文档范围 |

### 输入对抗面

N/A — 不新增对外 agent 或输入处理逻辑。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 文档示例省略必填 `branch` 时是否明确指出请求会失败
- 重复提交: N/A，文档无写操作
- 中途中断: 从 GET 章节单独进入时能否找到 attempt id 来自 POST 响应
- 边界值: 九角色是否完整且没有把未授权角色写入白名单
发现分级: P0/P1（鉴权或字段说明会泄密/导致错误派发）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## E2E 验收

**journey_type**: dev_pipeline
**target_environment**: local_api（文档静态验收，无 Postgres/服务启动）

```bash
set -euo pipefail
cd /workspace
npx vitest run sprints/coding-harness-20260831234617-skjrw4/tests/attempt-run-bridge-doc.test.ts --no-cache --reporter=dot
CHANGED=$(git diff --name-only 88929fa377f5bed3cd1876a575c366ff1b93c0d5...HEAD | awk '!/^sprints\/coding-harness-20260831234617-skjrw4\//')
[ "$CHANGED" = "docs/current/attempt-run-bridge-guide.md" ] || { echo "FAIL: 实现范围必须仅含目标文档，实际=$CHANGED"; exit 1; }
echo "OK: attempt-run 桥接说明四节齐全且实现范围合规"
```

**通过标准**: 4 tests passed；实现提交相对权威基线除 sprint 合同产物外仅新增 `docs/current/attempt-run-bridge-guide.md`；退出码 0。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260831234617-skjrw4/tests/attempt-run-bridge-doc.test.ts` | `文档说明两个端点用途与 internalAuthOrLoopback 鉴权`、`文档逐项列出九个角色白名单`、`文档说明 payload 三个必填字段与 base_sha 省略语义`、`文档说明派发失败后的三项自动回滚终态` | 4 failures：目标文档不存在（ENOENT） |

冻结测试已落盘；覆盖名均为对应 `it()` 名的字面子串。
