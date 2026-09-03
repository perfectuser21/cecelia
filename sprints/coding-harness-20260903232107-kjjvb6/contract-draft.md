# Sprint Contract Draft (Round 3)

## Notes

- authoritative implementation baseline: `807519cd97385f72f2e32d683b7430f84220116f`（来自 task bundle `inputs.implementation_baseline.base_sha`；不采用 PRD 中过时的版本值）。
- `[MAP_NOT_CONFIGURED]`：task 的 `map_scope` 不是可用字符串且 `map_repo` 缺失，因此无 `must_run_assertions`；不做领域硬编码回退。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: N/A）

N/A — 本任务只新增说明文档，无 HTTP 响应变更。

## 已知约束

- [`packages/brain/src/routes/__tests__/harness-attempt-run.test.js`] → 生产路由同时注册 `/attempt-run` 与 `/attempt-run/:attemptId`。
- [`packages/brain/src/middleware/internal-auth.test.js`] → `internalAuthOrLoopback` 区分 loopback 与远端，并在配置 token 后严格鉴权。
- `[累积FR]` 本 line 暂无历史；`journey_id=none`，无可请求的 context-manifest。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-bridge-guide.md` 新增中文说明，准确覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 所有封闭枚举现场计数；每个正向 oracle 同时包含对应负向排除 oracle；仅改一页业务文档。 |
| Invariant（永不违反） | 不泄露真实 token；不修改代码、接口、鉴权、白名单或状态机。 |
| 判定点（怎么知道） | 文档集合与生产源码冻结事实逐项相等，范围由全仓 diff 判定。 |
| 保质期（何时过期） | 端点、鉴权、角色、payload 或回滚语义变化时，由接口维护者同步更新本文。 |
| 死亡告警（停了谁知道） | 文档事实漂移由冻结测试/CI 失败在 PR 阶段通知提交者。 |
| 失败语义（挂了怎么办） | 任一枚举、负向排除或范围断言失败即阻塞合并，不降级放行。 |
| 效果确认（已发≠已生效） | 候选 HEAD 上读取文档并验证内容；再以冻结 base SHA 做全仓 diff 验证实际改动范围。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺项、错项或多项 | 测试非零退出并阻塞合并 | 是，修正文档后可重跑 | 无 |
| 候选改动越界 | 范围 oracle 非零退出并阻塞合并 | 是，移除越界改动后可重跑 | 无 |

### 输入对抗面

N/A — 本任务不新增或修改对外 agent 输入面。

## Golden Path

独立小路（无父路）

[读者打开文档] → [理解创建与查询] → [按环境正确鉴权] → [按封闭角色和字段创建] → [判读失败回滚]

### Step 1: 读者定位创建与查询用途
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 项。

**可观测行为**: 文档必须有独立 `## 端点与用途` 章节；该章节以三级标题完整枚举主端点，且标题集合恰好为 `POST /api/brain/harness/attempt-run` 与 `GET /api/brain/harness/attempt-run/:id` 两项。前者说明创建并异步派发，后者说明按 attempt id 查询；重复、缺失或增加任何主端点都失败。

**验证命令**: `npx vitest run sprints/coding-harness-20260903232107-kjjvb6/tests/attempt-run-bridge-doc.contract.test.ts -t "完整解析端点章节且主端点集合恰为 POST 与 GET 两项"`

**硬阈值**: 端点封闭集合数量 = 2；正向用途均存在，负向额外端点数量 = 0。

### Step 2: 读者按来源环境鉴权
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 项及「边界情况」。

**可观测行为**: 文档必须有独立 `## 鉴权` 章节并写明 `internalAuthOrLoopback`。其中 `宿主` 与 `远端` 必须分成两行，分别逐字携带 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`；loopback 另行表述。不得暴露真实值，也不得宣称宿主或远端免鉴权。

**验证命令**: `npx vitest run sprints/coding-harness-20260903232107-kjjvb6/tests/attempt-run-bridge-doc.contract.test.ts -t "宿主和远端分别要求 Bearer 且负向排除泄密与免鉴权"`

**硬阈值**: 正向鉴权说明 = 1 组；真实 token 泄露 = 0；远端免鉴权表述 = 0。

### Step 3: 读者从九项封闭角色中选择
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项；角色字面值取自生产 `ALLOWED_ROLES`。

**可观测行为**: 角色逐项列为 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，无别名或额外角色。

**验证命令**: `npx vitest run sprints/coding-harness-20260903232107-kjjvb6/tests/attempt-run-bridge-doc.contract.test.ts -t "角色白名单现场计数为九项且封闭集合无别名"`

**硬阈值**: 唯一角色数量 = 9；缺失、别名、额外项数量均 = 0。

### Step 4: 读者构造 payload
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项。

**可观测行为**: 文档逐项列出三个必填字段 `sprint_dir`、`base_repo`、`branch`，以及一个可省略字段 `base_sha`；后者由生产 Brain 自行解析。

**验证命令**: `npx vitest run sprints/coding-harness-20260903232107-kjjvb6/tests/attempt-run-bridge-doc.contract.test.ts -t "payload 必填三项可选一项并排除 base_sha 必填"`

**硬阈值**: 必填封闭集合数量 = 3；可省略集合数量 = 1；`base_sha` 被列为必填的次数 = 0。

### Step 5: 读者判读派发失败终态
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 项及「边界情况」。

**可观测行为**: 文档把派发失败自动回滚逐项写为 `run→failed`、`session→closed`、`task→cancelled`，不描述成调用方操作。

**验证命令**: `npx vitest run sprints/coding-harness-20260903232107-kjjvb6/tests/attempt-run-bridge-doc.contract.test.ts -t "派发失败回滚现场计数为三个自动终态且排除调用方触发"`

**硬阈值**: 自动终态封闭集合数量 = 3；错误终态和调用方触发表述数量均 = 0。

### Step 6: 全仓范围保持为合同产物与一页业务文档
**来源**: `[AI_ADDED]` — 用冻结 implementation baseline 防止以工作区当前状态替代权威基线，并防止夹带业务代码。

**可观测行为**: canonical 全仓 diff 只包含本 sprint 四个冻结合同产物与目标文档；目标文档存在且任何代码路径均未变化。

**验证命令**: `BASE_SHA=807519cd97385f72f2e32d683b7430f84220116f; git diff --name-only "$BASE_SHA"...HEAD`

**硬阈值**: 全仓 diff 封闭集合数量 = 5；额外路径数量 = 0；其中 `docs/current/` 业务交付文档数量 = 1，代码文件数量 = 0。

## 断言自洽声明

- 两两推演「数量 + 存在」：端点章节的三级标题总数和去重数都必须为 2，集合逐字等于指定 POST/GET；角色总数和去重数均为 9；payload 必填 3 个/可省略 1 个且集合逐字相等；回滚总数和去重数均为 3。重复会破坏总数或去重数，缺失/额外项会破坏集合相等。
- 每组正向 oracle 均绑定负向 oracle：完整端点章节恰有两项 ↔ 无额外主端点；宿主和远端两行分别含 Bearer 占位符 ↔ 无真实 token 且两者均无免鉴权表述；九角色存在 ↔ 无别名/额外项；三必填一可选存在 ↔ `base_sha` 非必填；三回滚存在 ↔ 非调用方触发；目标文档存在 ↔ canonical 全仓 diff 无越界路径。
- 范围验证固定使用 `git diff --name-only "$BASE_SHA"...HEAD`，其中 `BASE_SHA=807519cd97385f72f2e32d683b7430f84220116f`；不得替换为 workspace checkout SHA、`origin/main` 或工作区未提交 diff。

## 真实调用方请求 shape

N/A — 本任务不改变调用方或接口；文档仅引用生产路由现有 shape。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期或 DB 写路径，N/A）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否把 `base_sha` 误归为必填。
- 重复提交: 检查列表重复项是否能被唯一计数断言捕获。
- 中途中断: N/A — 静态文档无运行中状态。
- 边界值: 检查九角色和三回滚集合的零项、缺一项、多一项。
发现分级: P0/P1（泄密、错误远端鉴权或错误回滚指导）阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=807519cd97385f72f2e32d683b7430f84220116f
SPRINT_DIR=sprints/coding-harness-20260903232107-kjjvb6
DOC=docs/current/attempt-run-bridge-guide.md
TEST="$SPRINT_DIR/tests/attempt-run-bridge-doc.contract.test.ts"

npx vitest run "$TEST" --reporter=verbose

EXPECTED=$(mktemp)
ACTUAL=$(mktemp)
trap 'rm -f "$EXPECTED" "$ACTUAL"' EXIT
printf '%s\n' \
  docs/current/attempt-run-bridge-guide.md \
  sprints/coding-harness-20260903232107-kjjvb6/contract-dod.md \
  sprints/coding-harness-20260903232107-kjjvb6/contract-draft.md \
  sprints/coding-harness-20260903232107-kjjvb6/task-plan.json \
  sprints/coding-harness-20260903232107-kjjvb6/tests/attempt-run-bridge-doc.contract.test.ts \
  | sort > "$EXPECTED"
git diff --name-only "$BASE_SHA"...HEAD | sort > "$ACTUAL"
diff -u "$EXPECTED" "$ACTUAL"
[ "$(wc -l < "$ACTUAL" | tr -d ' ')" -eq 5 ]
[ "$(grep -c '^docs/current/' "$ACTUAL")" -eq 1 ]
if grep -Ev '^(docs/current/attempt-run-bridge-guide\.md|sprints/coding-harness-20260903232107-kjjvb6/(contract-draft\.md|contract-dod\.md|task-plan\.json|tests/attempt-run-bridge-doc\.contract\.test\.ts))$' "$ACTUAL"; then
  echo 'FAIL: canonical 全仓 diff 出现未枚举路径'
  exit 1
fi
[ -f "$DOC" ]
echo 'OK: 文档五组封闭枚举与 canonical 全仓范围均通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接文档封闭合同 | `sprints/coding-harness-20260903232107-kjjvb6/tests/attempt-run-bridge-doc.contract.test.ts` | `完整解析端点章节且主端点集合恰为 POST 与 GET 两项` / `宿主和远端分别要求 Bearer 且负向排除泄密与免鉴权` / `角色白名单现场计数为九项且封闭集合无别名` / `payload 必填三项可选一项并排除 base_sha 必填` / `派发失败回滚现场计数为三个自动终态且排除调用方触发` | 目标文档尚不存在，`readFileSync` 抛出 ENOENT，5 个测试均失败 |
