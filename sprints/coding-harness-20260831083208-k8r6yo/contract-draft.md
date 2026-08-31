# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A — 文档任务不新增或修改 HTTP 响应）

N/A — 本 sprint 只新增使用说明，不修改两个既有端点、数据库或响应结构。文档中的事实以 `packages/brain/src/routes/harness-attempt-run.js` 与 `packages/brain/src/middleware/internal-auth.js` 为准。

## 已知约束（来自回归测试 + 累积 FR）

- [`packages/brain/src/routes/__tests__/harness-attempt-run.test.js`] → 既有路由测试要求 POST/GET 路径存在、角色白名单完整且非法角色返回 `role_not_allowed`。
- [`tests/gp/f1/step3-attempt-run-endpoint.test.js`] → attempt-run 是 F1 第 3 步既有桥接面；本 sprint 只解释现状，不改变实现。
- [累积FR] context-manifest: unavailable（任务 bundle 未提供 journey_id，无法定位累积 FR）。
- [MAP_NOT_CONFIGURED] task bundle 未提供 `map_scope`/`map_repo`，无 `must_run_assertions` 可纳入。

## 锚定父路声明

覆盖父路 F1（工厂·开发闭环）第 3 步：为既有 attempt-run 单角色派发及结果轮询桥接面补齐操作者说明，不改变父路行为。

## Golden Path

[操作者打开说明] → [确认端点与鉴权] → [选择九项白名单角色并构造 payload] → [理解派发失败回滚终态]

### Step 1: 识别 POST 派发与 GET 轮询入口及鉴权
**来源**: `[FROM_PRD]` — PRD「范围」第 1 项。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 用中文分别说明 POST 异步派发、GET 按 attempt id 轮询结构化结果；说明两者均挂 `internalAuthOrLoopback`，生产 Brain 配置 token 时，宿主或远端请求必须带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。

**验证命令**:
```bash
npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-guide.test.ts -t "端点用途与鉴权" --no-cache --reporter=dot
```
**硬阈值**: 用例 1 passed、命令退出码 0；缺任一端点、鉴权名或 Bearer 示例均失败。

### Step 2: 从完整九项白名单选择角色
**来源**: `[FROM_PRD]` — PRD「范围」第 2 项。

**可观测行为**: 文档逐字列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，且明确白名单外角色会被拒绝。

**验证命令**:
```bash
npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-guide.test.ts -t "九项角色白名单" --no-cache --reporter=dot
```
**硬阈值**: 九个角色均出现且恰好声明为九项；用例 1 passed、命令退出码 0。

### Step 3: 按字段约束构造 payload
**来源**: `[FROM_PRD]` — PRD「范围」第 3 项。

**可观测行为**: 文档将 `sprint_dir`、`base_repo`、`branch` 标为必填，并明确 `base_sha` 可省略、由生产 Brain 自解析；提供不含真实凭据的 POST JSON 示例。

**验证命令**:
```bash
npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-guide.test.ts -t "payload 必填字段" --no-cache --reporter=dot
```
**硬阈值**: 三个必填字段与 `base_sha` 省略语义全部可机检；用例 1 passed、命令退出码 0。

### Step 4: 识别派发失败后的自动回滚终态
**来源**: `[FROM_PRD]` — PRD「范围」第 4 项。

**可观测行为**: 文档明确 dispatch 抛错或未返回 `LAUNCHED` 时，只有本调用新建的桥接资源被自动回滚为 run=`failed`、session=`closed`、task=`cancelled`。

**验证命令**:
```bash
npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-guide.test.ts -t "派发失败自动回滚" --no-cache --reporter=dot
```
**硬阈值**: 三类资源与三个终态逐项匹配；用例 1 passed、命令退出码 0。

## 真实调用方请求 shape

- 认证：`Authorization: Bearer $CECELIA_INTERNAL_TOKEN`；本机 loopback 仅在未配置 token 时由 `internalAuthOrLoopback` 放行，宿主/远端不视为 loopback。
- POST：`Content-Type: application/json`，顶层含 `role`、`title`、`payload`；本 sprint 文档只承诺 PRD 指定的 payload 字段语义。
- GET：路径参数为 POST 返回的 `attempt_id`。

## 禁 mock 边清单

（本单纯文档改动，不改调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，无被改接缝边，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本单只记录既有接口，不改变真实世界接缝；验收读取交付文档并与既有源码事实逐项核对，N/A。）

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|---|---|---|
| FR（做什么） | 功能承诺 | 新增一页中文说明，覆盖端点鉴权、九项角色、payload 字段、失败回滚四节 |
| NFR（做得多好） | 质量约束 | 四节均由冻结测试逐字核对；实现变更仅一份 `docs/current/` 文档 |
| Invariant（永不违反） | 不变量 | 不修改代码；不写入 token 字面值；不把宿主/远端误称为 loopback |
| 判定点（怎么知道） | 判断方法 | 见下方登记表；本任务无模糊现实判定点 |
| 保质期（何时过期） | 退役条件 | 当 attempt-run 路由、鉴权、角色或 payload 契约变化时由接口维护者同步更新文档 |
| 死亡告警（停了谁知道） | 失效发现 | 冻结测试在 Sprint Tests/CI 中因文档缺节或字段漂移失败 |
| 失败语义（挂了怎么办） | 故障策略 | 文档断言缺项即测试非零退出并阻塞合入，不降级放行 |
| 效果确认（已发≠已生效） | 回执 | 读取实际交付文档，逐项断言四节事实并核对只改允许路径 |

### 判定点登记表（对模糊现实的判断假设）

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或四节任一事实缺失 | 冻结测试失败，阻塞合入 | 是，补全文档后重跑 | 不允许降级 |
| 实现 diff 出现 `docs/current/` 目标文档以外文件 | 范围断言失败，阻塞合入 | 是，移除越界变更后重跑 | 不允许降级 |

### 输入对抗面

N/A — 本 sprint 不新增对外 agent 或可写接口，只编写既有内部接口说明。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误导读者认为未带 token 的宿主请求可放行
- 重复提交: 检查九项角色是否重复、遗漏或混入白名单外角色
- 中途中断: 检查只读 GET 流程能否从 POST 返回的 `attempt_id` 自洽续接
- 边界值: 检查 `base_sha` 省略语义是否明确限定为生产 Brain 自解析
发现分级: P0/P1（泄露凭据、错误鉴权或回滚语义）阻塞 merge；P2/P3（排版）记录 findings

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: dev_pipeline
**target_environment**: local_api（文档验收；不启动服务、不连接数据库）

```bash
set -euo pipefail
cd /workspace
npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-guide.test.ts --no-cache --reporter=dot
git diff --name-only 5c12d2af68e2b2e4b8dcaaa2c87e50efab743291...HEAD -- docs/current packages | grep -qx 'docs/current/attempt-run-bridge-guide.md'
echo "OK: attempt-run 桥接使用说明四节与范围已验证"
```

**通过标准**: 冻结测试 5 passed、退出码 0；实现基线 `5c12d2af68e2b2e4b8dcaaa2c87e50efab743291` 之后 `docs/current` 与 `packages` 范围内唯一变化为 `docs/current/attempt-run-bridge-guide.md`。

gp-anchor: skipped (product-map.json not found)

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明四节与范围 | `sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-guide.test.ts` | `端点用途与鉴权`、`九项角色白名单`、`payload 必填字段`、`派发失败自动回滚`、`实现范围只允许目标文档` | 目标文档尚不存在，5 个用例均失败 |

## Notes

- contract-gate: 使用 Cecelia 仓现有 gate；本合同没有新增代码层行为。
- implementation baseline: `5c12d2af68e2b2e4b8dcaaa2c87e50efab743291`，不得用角色 checkout SHA 替换。
