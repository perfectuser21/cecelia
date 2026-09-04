# Sprint Contract Draft (Round 1)

## Notes

- authoritative implementation baseline: `bdaca81b5cbf78929fa3d8eeac2a24cae6113b98`（来自 `inputs.implementation_baseline.base_sha`，跨角色及 GAN 轮次保持不变）。
- `[MAP_NOT_CONFIGURED]`：task 的 `map_scope` 不是可用字符串且 `map_repo` 缺失，无 `must_run_assertions`，不回退领域硬编码。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: N/A）

N/A — 本任务只新增说明文档，无 HTTP 响应变更。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 生产路由注册 `/attempt-run` 与 `/attempt-run/:attemptId`。
- `packages/brain/src/middleware/internal-auth.test.js` → `internalAuthOrLoopback` 区分 loopback 与远端鉴权。
- `[累积FR]` 本 line 暂无历史；`journey_id=none`，无可请求的 context-manifest。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-bridge-guide.md` 新增中文说明，覆盖端点、鉴权、九角色、payload/基线与失败回滚。 |
| NFR（做得多好） | 封闭集合逐项列名并现场计数；每个正向 oracle 有负向 oracle；仅改一页业务文档。 |
| Invariant（永不违反） | 不泄露真实 token；不修改代码、接口、鉴权或状态机；实现基线不随角色 checkout 改变。 |
| 判定点（怎么知道） | 按 PRD 字面集合解析文档，范围用冻结基线的 canonical git diff 判定。 |
| 保质期（何时过期） | 端点契约变化时由 Harness 维护者同步更新文档。 |
| 死亡告警（停了谁知道） | 冻结合同测试或范围 oracle 在 CI 失败并通知 PR 提交者。 |
| 失败语义（挂了怎么办） | 任一内容、集合、负向或范围断言失败即阻塞合并。 |
| 效果确认（已发≠已生效） | 从候选 HEAD 读取文档并逐项解析，再对冻结基线执行全仓范围检查。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺项、错项、重复或多项 | 非零退出并阻塞合并 | 是 | 无 |
| 候选改动越界 | 非零退出并阻塞合并 | 是 | 无 |

### 输入对抗面

N/A — 本任务不新增或修改对外 agent 输入面。

## Golden Path

独立小路（无父路）

[读者打开文档] → [理解端点与鉴权] → [按封闭角色及 payload 创建] → [查询结果并理解失败回滚]

### Step 1: 定位创建与查询用途
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 项。

**可观测行为**: `## 端点与用途` 章节的三级标题集合恰为 `POST /api/brain/harness/attempt-run` 和 `GET /api/brain/harness/attempt-run/:id`，分别说明创建并异步派发和按 attempt id 查询；重复、缺失或额外端点均失败。

**验证命令**: `npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-doc.contract.test.ts -t "端点用途封闭集合为 POST 创建与 GET 查询且排除额外端点"`

**硬阈值**: 端点总数 = 唯一数 = 2；额外端点数 = 0。

### Step 2: 按来源环境鉴权
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 项及「边界情况」。

**可观测行为**: `## 鉴权` 写明 `internalAuthOrLoopback`；宿主与远端各自逐字要求 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`，loopback 单独说明；不得泄露真实 token 或宣称宿主/远端免鉴权。

**验证命令**: `npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-doc.contract.test.ts -t "宿主和远端分别要求 Bearer 且排除泄密与免鉴权"`

**硬阈值**: 宿主 Bearer 行 = 1，远端 Bearer 行 = 1；泄密与免鉴权误导 = 0。

### Step 3: 从九项角色封闭集合选择
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项。

**可观测行为**: 逐项且仅列 `planner`、`proposer`、`proposer-critic`、`generator`、`generator-critic`、`evaluator`、`evaluator-critic`、`reporter`、`reporter-critic`。

**验证命令**: `npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-doc.contract.test.ts -t "角色白名单现场计数九项且封闭集合无额外角色"`

**硬阈值**: 角色总数 = 唯一数 = 9；缺失或额外角色数 = 0。

### Step 4: 构造 payload 并保持实现基线
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项。

**可观测行为**: 三个必填字段逐项为 `sprint_dir`、`base_repo`、`branch`；`base_sha` 为唯一可省略字段并由生产 Brain 自解析；实现基线跨角色及 GAN 轮次不变，`workspace_spec.base_sha` 只选择 checkout、不得替代实现基线。

**验证命令**: `npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-doc.contract.test.ts -t "payload 必填三项可选一项且排除 base_sha 必填"`

**硬阈值**: 必填总数 = 唯一数 = 3；可省略总数 = 1；把 `base_sha` 列为必填的次数 = 0。

### Step 5: 判读派发失败出口
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 项及「边界情况」。

**可观测行为**: `## 派发失败自动回滚` 逐项且仅列 `run→failed`、`session→closed`、`task→cancelled`，说明这是自动回滚，不得描述为部分成功或调用方操作。

**验证命令**: `npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-doc.contract.test.ts -t "派发失败回滚现场计数三个自动终态且排除部分成功"`

**硬阈值**: 回滚总数 = 唯一数 = 3；错误终态、部分成功、调用方触发表述 = 0。

### Step 6: 保持交付范围封闭
**来源**: `[AI_ADDED]` — 以冻结 implementation baseline 防止角色 checkout SHA 替代权威基线，并防止夹带代码。

**可观测行为**: canonical 全仓 diff 只含本 sprint 四个冻结合同产物及一页目标文档，业务交付只有 `docs/current/attempt-run-bridge-guide.md`，代码变化为零。

**验证命令**: `BASE_SHA=bdaca81b5cbf78929fa3d8eeac2a24cae6113b98; git diff --name-only "$BASE_SHA"...HEAD`

**硬阈值**: diff 封闭集合总数 = 5；`docs/current/` 业务文档数 = 1；额外路径与代码路径数 = 0。

## 断言自洽声明

- 原子断言总数 = 30：端点 5、鉴权 5、角色 3、payload/基线 8、回滚 6、范围 3。
- 两两推演结论：每个枚举同时约束顺序集合、现场总数/唯一数，故重复、缺失、额外项都不能同时通过；每个正向存在 oracle 均有泄密、免鉴权、错误分类、部分成功、调用方触发或越界路径的负向 oracle。
- 六组之间无矛盾：内容组只约束目标文档，范围组允许且仅允许四个冻结合同产物加目标文档；业务范围仍是一页文档。canonical 范围命令逐字固定为 `BASE_SHA=bdaca81b5cbf78929fa3d8eeac2a24cae6113b98; git diff --name-only "$BASE_SHA"...HEAD`，不得替换为 workspace checkout SHA 或 `origin/main`。

## 真实调用方请求 shape

N/A — 本任务不改变调用方或接口，只记录 PRD 已冻结的使用契约。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期或 DB 写路径，N/A）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否把 `base_sha` 误归为必填。
- 重复提交: 检查列表重复项是否被总数和唯一数共同捕获。
- 中途中断: N/A — 静态文档无运行中状态。
- 边界值: 检查九角色与三回滚集合的缺一项、多一项和重复项。
发现分级: P0/P1（泄密、错误鉴权、错误基线或失败出口）阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=bdaca81b5cbf78929fa3d8eeac2a24cae6113b98
SPRINT_DIR=sprints/coding-harness-20260904034439-v1423a
DOC=docs/current/attempt-run-bridge-guide.md
TEST="$SPRINT_DIR/tests/attempt-run-bridge-doc.contract.test.ts"
npx vitest run "$TEST" --reporter=verbose
EXPECTED=$(mktemp)
ACTUAL=$(mktemp)
trap 'rm -f "$EXPECTED" "$ACTUAL"' EXIT
printf '%s\n' docs/current/attempt-run-bridge-guide.md "$SPRINT_DIR/contract-dod.md" "$SPRINT_DIR/contract-draft.md" "$SPRINT_DIR/task-plan.json" "$SPRINT_DIR/tests/attempt-run-bridge-doc.contract.test.ts" | sort > "$EXPECTED"
git diff --name-only "$BASE_SHA"...HEAD | sort > "$ACTUAL"
diff -u "$EXPECTED" "$ACTUAL"
[ "$(wc -l < "$ACTUAL" | tr -d ' ')" -eq 5 ]
[ "$(grep -c '^docs/current/' "$ACTUAL")" -eq 1 ]
if grep -Ev '^(docs/current/attempt-run-bridge-guide\.md|sprints/coding-harness-20260904034439-v1423a/(contract-draft\.md|contract-dod\.md|task-plan\.json|tests/attempt-run-bridge-doc\.contract\.test\.ts))$' "$ACTUAL"; then echo 'FAIL: canonical 全仓 diff 出现未枚举路径'; exit 1; fi
[ -f "$DOC" ]
echo 'OK: 30 项内容与范围断言全部通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明封闭合同 | `sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-doc.contract.test.ts` | `端点用途封闭集合为 POST 创建与 GET 查询且排除额外端点` / `宿主和远端分别要求 Bearer 且排除泄密与免鉴权` / `角色白名单现场计数九项且封闭集合无额外角色` / `payload 必填三项可选一项且排除 base_sha 必填` / `派发失败回滚现场计数三个自动终态且排除部分成功` | 目标文档尚不存在，5 个测试均因 `readFileSync` 的 ENOENT 失败 |
