# Sprint Contract Draft (Round 1)

## 实现基线与范围

- authoritative implementation baseline: `37fc357d927b1429de59e1b50e4de762c5e7ea18`（来自 `inputs.implementation_baseline.base_sha`；不得用角色 checkout 替换）
- 交付封闭集合：仅新增 `docs/current/attempt-run-bridge-guide.md`；不得修改代码、测试代码、数据库或既有文档。
- `task_request_hash: 239fe1b9cb13af9ee1c12171b0671dd016272a07bf59ddfda51e786809fc5946`
- Unified Map: `[MAP_NOT_CONFIGURED]`；无 `must_run_assertions`、`fact_revisions` 或 freshness 输入。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD字面）

N/A — 任务只新增使用说明，不改变 HTTP 响应。

## 已知约束

- [PRD/实现] `packages/brain/src/routes/harness-attempt-run.js` 的 `ALLOWED_ROLES` 是九项角色白名单事实源。
- [PRD/实现] 两个端点均使用 `internalAuthOrLoopback`。
- [累积FR] 本 line 暂无历史。
- context-manifest: journey_id 为 none，无可查询 journey。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接使用说明，覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 内容与实现基线逐字一致；仅新增一个 `docs/current/` 直属 Markdown 文件。 |
| Invariant（永不违反） | 不泄露凭据；不改运行时；基线固定为 `37fc357d927b1429de59e1b50e4de762c5e7ea18`。 |
| 判定点（怎么知道） | 见下方登记表。 |
| 保质期（何时过期） | 端点、角色或 payload 合同变化时由对应代码变更同步更新本文。 |
| 死亡告警（停了谁知道） | N/A：纯文档；内容漂移由冻结测试和 diff oracle 阻断。 |
| 失败语义（挂了怎么办） | 任一关键词、角色、范围或负向 oracle 不满足即验收失败，禁止交付。 |
| 效果确认（已发≠已生效） | 在候选提交树读取文档，并与实现常量及 canonical baseline diff 交叉验证。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺项或内容漂移 | 静态验收非零退出 | 是 | 不降级，修正文档 |
| 超出单文件范围 | canonical diff oracle 非零退出 | 是 | 不降级，移除越界变更 |

### 输入对抗面

N/A：不新增对外 agent 或可写接口。

## Golden Path

独立小路（无父路）

[进入文档] → [理解端点与鉴权] → [核对角色和 payload] → [理解失败回滚]

### Step 1: 识别创建与查询端点及鉴权边界
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1-2 项。

**可观测行为**: 文档独立说明 `POST /api/brain/harness/attempt-run` 用于异步创建/派发，`GET /api/brain/harness/attempt-run/:id` 用于查询；说明 loopback 与宿主/远端差异，后者必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。

**验证命令**: `DOC=docs/current/attempt-run-bridge-guide.md; grep -Fq 'POST /api/brain/harness/attempt-run' "$DOC" && grep -Fq 'GET /api/brain/harness/attempt-run/:id' "$DOC" && grep -Fq 'internalAuthOrLoopback' "$DOC" && grep -Fq 'Bearer CECELIA_INTERNAL_TOKEN' "$DOC"`

**硬阈值**: 四个字面全部出现；任一缺失即失败。

### Step 2: 逐项核对九项角色白名单
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项；名称取自实现基线的 `ALLOWED_ROLES`。

**可观测行为**: 文档逐项列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，无别名或第十项。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901233352-djtrpz/tests/attempt-run-bridge-guide.test.ts`

**硬阈值**: 白名单集合与实现常量完全相等且数量恰为 9。

### Step 3: 区分 payload 必填项与可省略基线
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项和「边界情况」。

**可观测行为**: 文档把 `sprint_dir`、`base_repo`、`branch` 标为必填，把 `base_sha` 标为可省略并说明由生产 Brain 自解析；不得把角色 checkout SHA 说成实现基线。

**验证命令**: `DOC=docs/current/attempt-run-bridge-guide.md; grep -Eq 'sprint_dir.*必填' "$DOC" && grep -Eq 'base_repo.*必填' "$DOC" && grep -Eq 'branch.*必填' "$DOC" && grep -Eq 'base_sha.*(可省略|选填).*生产 Brain.*自解析' "$DOC"`

**硬阈值**: 三项必填语义和一项可省略语义全部命中。

### Step 4: 理解派发失败的原子回滚结果
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 项。

**可观测行为**: 文档同时给出 `run→failed`、`session→closed`、`task→cancelled`，避免只描述部分状态。

**验证命令**: `DOC=docs/current/attempt-run-bridge-guide.md; grep -Fq 'run→failed' "$DOC" && grep -Fq 'session→closed' "$DOC" && grep -Fq 'task→cancelled' "$DOC"`

**硬阈值**: 三个最终状态字面全部出现。

### Step 5: 证明交付保持文档单文件封闭集合
**来源**: `[AI_ADDED]` — 将 PRD 的“不改任何代码”转为不可由角色 checkout SHA漂移绕过的 canonical diff oracle。

**可观测行为**: 相对 authoritative implementation baseline 只新增目标文档，且精确 trace hash 存在。

**验证命令**: `BASE=37fc357d927b1429de59e1b50e4de762c5e7ea18; test "$(git diff --name-status "$BASE"...HEAD)" = $'A\tdocs/current/attempt-run-bridge-guide.md' && grep -Fxq 'task_request_hash: 239fe1b9cb13af9ee1c12171b0671dd016272a07bf59ddfda51e786809fc5946' docs/current/attempt-run-bridge-guide.md`

**硬阈值**: canonical diff 精确一行 `A`，trace hash 精确匹配。

## 真实调用方请求 shape

N/A：本 sprint 只说明既有接口，不新增或修改调用 shape。文档示例必须使用 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，不得含真实 token；payload 字段按 PRD 字面。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期或 DB 写边，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A；验收对象为提交树中的真实文档与真实实现常量。）

## 接缝清单

（纯文档，无真机、异步消息或第三方接缝，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例是否误把 `base_sha` 写为必填。
- 重复提交: N/A（无写操作）。
- 中途中断: N/A（静态文档）。
- 边界值: 检查角色列表是否有遗漏、重复或别名。
发现分级: P0/P1（泄密、错误鉴权或错误契约）阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web（仅在 checkout 中运行静态文档与 git oracle，不启动 UI）

```bash
#!/usr/bin/env bash
set -euo pipefail
BASE=37fc357d927b1429de59e1b50e4de762c5e7ea18
DOC=docs/current/attempt-run-bridge-guide.md
test "$(git diff --name-status "$BASE"...HEAD)" = $'A\tdocs/current/attempt-run-bridge-guide.md'
test -f "$DOC"
grep -Fxq 'task_request_hash: 239fe1b9cb13af9ee1c12171b0671dd016272a07bf59ddfda51e786809fc5946' "$DOC"
grep -Fq 'POST /api/brain/harness/attempt-run' "$DOC"
grep -Fq 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -Fq 'internalAuthOrLoopback' "$DOC"
grep -Fq 'Bearer CECELIA_INTERNAL_TOKEN' "$DOC"
grep -Eq 'sprint_dir.*必填' "$DOC"
grep -Eq 'base_repo.*必填' "$DOC"
grep -Eq 'branch.*必填' "$DOC"
grep -Eq 'base_sha.*(可省略|选填).*生产 Brain.*自解析' "$DOC"
grep -Fq 'run→failed' "$DOC"
grep -Fq 'session→closed' "$DOC"
grep -Fq 'task→cancelled' "$DOC"
npx vitest run --no-cache sprints/coding-harness-20260901233352-djtrpz/tests/attempt-run-bridge-guide.test.ts
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 文档完整性与封闭范围 | `sprints/coding-harness-20260901233352-djtrpz/tests/attempt-run-bridge-guide.test.ts` | `文档包含端点用途与鉴权边界`、`角色白名单恰好九项并与实现一致`、`payload 区分必填字段与可省略 base_sha`、`派发失败包含三个回滚终态`、`canonical 基线范围只允许新增目标文档` | 目标文档尚不存在，至少 5 个测试失败 |

## Notes

- contract-gate: applicable (`packages/brain/src/lib/contract-gate.js` exists)
- `journey_type=autonomous`，不适用 staging 预览闸。

