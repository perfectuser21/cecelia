# Sprint Contract Draft（Round 1）

## 范围与基线

- 权威实现基线：`88929fa377f5bed3cd1876a575c366ff1b93c0d5`。
- 交付物仅限新增 `docs/current/attempt-run-bridge-guide.md`；不得修改代码、配置、测试基础设施或既有文档。
- 文档使用简体中文；端点、字段、角色和状态等技术字面量保持源码拼写。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- gp-anchor: skipped (product-map.json not found)
- `[MAP_NOT_CONFIGURED]`：task bundle 未提供 map_scope/map_repo；无 must_run_assertions、fact_revisions 或 freshness 可纳入。

## Response Schema（推导来源：N/A）

N/A — 本 Sprint 只新增使用说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [`packages/brain/src/routes/harness-attempt-run.js`] `ALLOWED_ROLES` 是九项封闭白名单；文档必须逐字列全。
- [`packages/brain/src/routes/__tests__/harness-attempt-run.test.js`] → “角色白名单封闭：包含九个执行角色，永不包含 commander/publisher”。
- [`packages/brain/src/routes/__tests__/harness-attempt-run.test.js`] → Router 必须包含 `/attempt-run` 与 `/attempt-run/:attemptId`。
- [累积 FR] context-manifest: unavailable（task bundle 未提供 journey_id，无法形成端点坐标）。
- [铁律] 仅文档范围：不修改 `packages/brain`，因此 Brain 版本与 DevGate 不适用；不提交凭据；全部内容为简体中文。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接使用说明，覆盖端点用途、鉴权、九项角色、payload 与派发失败回滚。 |
| NFR（做得多好） | 四个主题各有独立二级标题；关键字可由自动测试逐字解析。 |
| Invariant（永不违反） | 只新增目标文档，不改代码；不写入真实 token；源码字面量不得改名。 |
| 判定点（怎么知道） | 以文档标题、正文关键字和 Git diff 文件集合判定。 |
| 保质期（何时过期） | 端点契约、角色白名单或回滚状态变化时由对应 Brain 变更同步更新本文。 |
| 死亡告警（停了谁知道） | 冻结测试在 Sprint Tests 中失败，PR 作者与 CI 维护者即时获知。 |
| 失败语义（挂了怎么办） | 任一主题缺失、字面量漂移或出现代码改动均阻塞交付。 |
| 效果确认（已发≠已生效） | 从提交树读取目标文档并解析四节；不以文件存在单独判定成功。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或关键字 | 测试非零退出并阻塞合并 | 是，补正文后可重跑 | 不降级 |
| 交付范围含代码 | Git 范围断言失败并阻塞合并 | 是，移除越界改动后可重跑 | 不降级 |

### 输入对抗面

N/A — 本 Sprint 不新增对外 Agent 或可写接口。

## 判定点登记说明

本任务不推断外部真实状态；所有判断均来自冻结源码契约与提交树，N/A。

## 真实调用方请求 shape

本 Sprint 不改 API；文档示例必须说明宿主或远端请求带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，loopback 由 `internalAuthOrLoopback` 按运行环境判定。POST 请求体顶层含 `role`、`title` 与 `payload`；payload 至少含 `sprint_dir`、`base_repo`、`branch`，`base_sha` 可省略并由生产 Brain 解析。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A；验收对象是静态中文说明文档，不派发真实 Fleet attempt。）

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 接缝清单

（无真实世界接缝；本文只记录既有接口契约，N/A。）

## Golden Path

独立小路（无父路）

[读者打开说明] → [理解两个端点与鉴权] → [选择合法角色] → [构造 payload] → [理解失败回滚]

### Step 1：读者识别端点用途与鉴权

**来源**：`[FROM_PRD]` — thin PRD 第 1 项。

**可观测行为**：文档分别解释 `POST /api/brain/harness/attempt-run` 的异步派发用途和 `GET /api/brain/harness/attempt-run/:id` 的轮询用途，并说明 `internalAuthOrLoopback`；宿主/远端必须使用 Bearer token。

**验证命令**：`node sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test-helper.cjs endpoints`

**硬阈值**：两个端点、`internalAuthOrLoopback`、`Authorization: Bearer` 与 `CECELIA_INTERNAL_TOKEN` 全部出现；命令 exit 0。

### Step 2：读者获得完整角色白名单

**来源**：`[FROM_PRD]` — thin PRD 第 2 项。

**可观测行为**：文档逐字列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，并明确白名单之外角色会被拒绝。

**验证命令**：`node sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test-helper.cjs roles`

**硬阈值**：九项恰好均可解析；命令 exit 0。

### Step 3：读者构造最小 payload

**来源**：`[FROM_PRD]` — thin PRD 第 3 项。

**可观测行为**：文档说明 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略并由生产 Brain 自解析。

**验证命令**：`node sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test-helper.cjs payload`

**硬阈值**：四个字段与“可省略/生产 Brain 自解析”语义均可解析；命令 exit 0。

### Step 4：读者理解派发失败回滚

**来源**：`[FROM_PRD]` — thin PRD 第 4 项。

**可观测行为**：文档明确派发抛错或未达到 `LAUNCHED` 时，新建资源自动回滚为 `run → failed`、`session → closed`、`task → cancelled`。

**验证命令**：`node sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test-helper.cjs rollback`

**硬阈值**：三组实体与终态映射全部出现；命令 exit 0。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算：10 分钟 / 15 动作

高风险面：
- 错输入：检查文档是否误把 `base_repo` 写为 `repo`，或把 GET 参数写成 run id。
- 重复提交：同一关键规则是否出现互相矛盾的两种说法。
- 中途中断：从任意小节单独阅读时，是否仍能辨认调用前提。
- 边界值：九项角色是否漏项、多项或拼写漂移。

发现分级：P0/P1（错误指导导致越权或派发错误）阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**：dev_pipeline
**target_environment**：local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
SPRINT_DIR="sprints/coding-harness-20260831174800-fxqhpa"
node "$SPRINT_DIR/tests/attempt-run-bridge-doc.test-helper.cjs" all
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-doc.test.ts"
CHANGED=$(git diff --name-only 88929fa377f5bed3cd1876a575c366ff1b93c0d5...HEAD)
printf '%s\n' "$CHANGED" | grep -qx 'docs/current/attempt-run-bridge-guide.md'
if printf '%s\n' "$CHANGED" | grep -Ev '^(docs/current/attempt-run-bridge-guide\.md|sprints/coding-harness-20260831174800-fxqhpa/(contract-draft\.md|contract-dod\.md|task-plan\.json|tests/attempt-run-bridge-doc\.test\.(ts|helper\.cjs)))$' | grep -q .; then
  echo 'FAIL: 存在合同范围外改动'
  exit 1
fi
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接中文说明 | `sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test.ts` | `说明两个端点用途与鉴权方式`；`列全九项角色白名单`；`说明 payload 必填字段与 base_sha 省略语义`；`说明派发失败自动回滚状态` | 目标文档尚不存在，4 个用例均失败 |

