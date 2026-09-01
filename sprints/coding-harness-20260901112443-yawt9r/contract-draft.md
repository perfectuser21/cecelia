# Sprint Contract Draft (Round 1)

## 证据来源与范围

- 权威 PRD：`sprint-prd.md` 与 frozen `thin_prd`；实现基线固定为 `d4ae8c6d2b777f5762c4cd88a8e8d56004c66750`。
- Unified Map：`[MAP_NOT_CONFIGURED]`；task payload 未提供可用的 `map_scope/map_repo`，`must_run_assertions=[]`。
- API registry：fresh，source revision `5599211397c88c3827d5ce4e9c6061b3802b4fc5`；本任务不新增或修改 API，仅记录既有端点的文档合同。
- 累积 FR：本 line 暂无历史；`journey_id=none`，无可查询的 context-manifest。
- contract-gate：启用（`packages/brain/src/lib/contract-gate.js` 存在）。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD字面）

N/A — 本任务仅新增使用说明，不新增或修改 HTTP 响应；文档不得扩写未被 PRD 指定的响应字段。

## 已知约束（来自回归测试）

- `tests/gp/f1/step3-attempt-run-endpoint.test.js` → POST 创建并派发 attempt，GET 按 attempt id 查询结构化结果。
- `tests/gp/f1/step3-attempt-run-endpoint.test.js` → 派发未 LAUNCHED 或抛错时，新建资源回滚为 run failed、session closed、task cancelled。
- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 路由工厂暴露 `/attempt-run` 与 `/attempt-run/:attemptId`。
- `packages/brain/src/middleware/internal-auth.test.js` → `internalAuthOrLoopback` 区分 loopback 与远端 Bearer 鉴权。
- `[累积FR]` 本 line 暂无历史。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-bridge-guide.md` 新增中文说明，覆盖端点用途、鉴权、PRD 指定九角色、payload 与失败回滚。 |
| NFR（做得多好） | 四个主题均有独立章节；字面值可由冻结测试解析；唯一产品变更为该文档。 |
| Invariant（永不违反） | 不展示真实 token；不描述匿名远端可访问；不把 `base_sha` 写成必填；不改代码、配置或既有文档。 |
| 判定点（怎么知道） | 见下方登记表。 |
| 保质期（何时过期） | 端点、角色或 payload 合同变化时由对应 API 变更负责人同步修订本文档。 |
| 死亡告警（停了谁知道） | 冻结 Vitest 在 Sprint Tests 中失败，PR 作者与 CI 维护者在本次 CI 周期内获知。 |
| 失败语义（挂了怎么办） | 任一章节缺失或字面合同漂移即测试失败并阻塞交付；不降级放行。 |
| 效果确认（已发≠已生效） | Vitest 读取最终文档并逐项断言四类内容及唯一产品文件范围。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺少任一合同项 | Vitest 非零退出，阻塞交付 | 是；补正文后可重复运行 | 无降级 |
| 文档泄露真实 token 或误述鉴权 | Vitest 非零退出，阻塞交付 | 是 | 无降级 |
| 出现代码、配置或既有文档变更 | 范围断言失败，阻塞交付 | 是；移除越界变更后重跑 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入处理面。

## 真实调用方请求 shape

本任务不修改真实调用方协议。文档只按 PRD 固定以下调用形态：远端或宿主请求使用 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`；POST payload 的必填键为 `sprint_dir`、`base_repo`、`branch`，`base_sha` 可省略。不得在示例中写入真实 token。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A；纯文档交付不发起生产 API 请求。）

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，无接缝边，N/A。）

## Golden Path

独立小路（无父路）

[阅读使用说明] → [选择端点并正确鉴权] → [按白名单和 payload 发起请求] → [查询并辨别派发或回滚结果]

### Step 1: 读者识别两个 attempt-run 端点用途

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 项。

**可观测行为**: 中文文档分别说明 POST 用于创建并派发 attempt，GET 用于按 id 查询 attempt-run 状态。

**验证命令**: `npx vitest run sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t '分别说明两个端点用途'`

**硬阈值**: 两个端点字面值及各自用途全部命中，命令 exit 0。

### Step 2: 读者按调用位置选择鉴权

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 2 项及「边界情况」第 1 项。

**可观测行为**: 文档明确 `internalAuthOrLoopback`，并要求宿主或远端携带 Bearer 环境变量 token，且不展示真实凭据。

**验证命令**: `npx vitest run sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t '说明 internalAuthOrLoopback 与远端 Bearer 鉴权'`

**硬阈值**: 鉴权中间件、Bearer、变量名、宿主/远端义务和防泄露说明全部命中，命令 exit 0。

### Step 3: 读者使用角色白名单和 payload 合同构造请求

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 3、4 项。

**可观测行为**: 文档逐字列出 PRD 指定的九个角色；将三个字段标为必填，并说明 `base_sha` 省略后由生产 Brain 自解析。

**验证命令**: `npx vitest run sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t '列出九项角色白名单|说明 payload 必填字段与 base_sha 省略语义'`

**硬阈值**: 九个角色集合无缺项，三个必填字段无缺项，`base_sha` 明确可省略，命令 exit 0。

### Step 4: 读者查询并辨别派发失败的完整回滚

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 5、6 项。

**可观测行为**: 文档同时描述 `run → failed`、`session → closed`、`task → cancelled`，不得只写部分状态。

**验证命令**: `npx vitest run sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t '完整说明派发失败自动回滚状态'`

**硬阈值**: 三对象状态链全部命中，命令 exit 0。

### Step 5: 交付范围保持为单一产品文档

**来源**: `[AI_ADDED]` — 将 PRD「不改任何代码」转为不可假绿的 git diff 范围断言。

**可观测行为**: 相对实现基线，产品交付仅新增目标文档；Sprint 冻结合同产物不计入产品实现范围。

**验证命令**: `npx vitest run sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t '产品交付只新增目标文档且不改代码'`

**硬阈值**: 除本 Sprint 冻结合同目录外的 changed files 完全等于 `docs/current/attempt-run-bridge-guide.md`，命令 exit 0。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA="d4ae8c6d2b777f5762c4cd88a8e8d56004c66750"
TEST_FILE="sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts"
npx vitest run "$TEST_FILE" --reporter=verbose
PRODUCT_CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD -- docs/current packages apps scripts .github | sort)
[ "$PRODUCT_CHANGED" = "docs/current/attempt-run-bridge-guide.md" ] || { echo "FAIL: 产品变更越界: $PRODUCT_CHANGED"; exit 1; }
git diff --check "$BASE_SHA"...HEAD
echo "OK: attempt-run 桥接使用说明验收通过"
```

通过标准：冻结测试全部通过；产品变更集合仅含目标文档；`git diff --check` 通过。超时预算 60 秒，任一命令非零即 FAIL。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误导读者把白名单外角色当成有效值。
- 重复提交: 检查同一字段在不同章节是否出现互相冲突的“必填/可省略”表述。
- 中途中断: N/A，纯静态文档无执行中断状态。
- 边界值: 检查九项角色是否恰好逐项可辨识，连字符角色未被拆词。
发现分级: P0/P1（凭据泄露、错误鉴权或错误回滚合同）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接使用说明 | `sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts` | `分别说明两个端点用途`；`说明 internalAuthOrLoopback 与远端 Bearer 鉴权`；`列出九项角色白名单`；`说明 payload 必填字段与 base_sha 省略语义`；`完整说明派发失败自动回滚状态`；`产品交付只新增目标文档且不改代码` | 目标文档尚不存在，6 个测试在读取文件时失败 |

## 接缝清单

本任务仅新增静态文档，不碰真机、第三方 API、生产环境或异步接缝；N/A。

## Notes

- PRD 是本轮冻结法律；合同不新增 API 行为，也不以当前起草角色的 attempt/capability 身份作为未来验收身份。
- 本任务不是 user_facing，staging 预览闸 N/A。
