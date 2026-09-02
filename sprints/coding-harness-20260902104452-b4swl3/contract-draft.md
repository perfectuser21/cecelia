# Sprint Contract Draft (Round 1)

task_request_hash: 36b99953756db7bbfbaa29fd6871c56a549f04acbec458352388564d4538b039

## Response Schema（推导来源: PRD字面）

N/A — 本任务仅新增说明文档，无 HTTP 响应或生产 API 行为变更。

## 已知约束

- [sprint-prd.md] → 仅新增 `docs/current/attempt-run-bridge-guide.md`，不改代码、测试、API 行为、鉴权、角色集合、数据库或部署配置。
- [累积FR] → 本 line 暂无历史。
- Unified Map: `[MAP_NOT_CONFIGURED]`（task payload 的 map_scope 为空；must_run_assertions 为空）。
- Registry: 本合同不定义新 API/DB schema，按冻结 PRD 字面约束；测试沿用 Vitest `describe/it/expect`。

gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接说明，覆盖端点、鉴权、九项角色、payload 和失败回滚。 |
| NFR（做得多好） | 字面值可机械核验；只新增指定文档；不得泄露真实 token。 |
| Invariant（永不违反） | 两端点均声明鉴权；凭据只用占位符；不改 Planner 分支或任何代码。 |
| 判定点（怎么知道） | 由冻结 PRD 的精确集合及文件差异断言判定。 |
| 保质期（何时过期） | API 契约变化时由维护者同步更新本页；本 Sprint 不定义自动过期。 |
| 死亡告警（停了谁知道） | CI 文档合同测试失败即由 PR 检查通知提交者。 |
| 失败语义（挂了怎么办） | 任一章节、字面值、精确集合或路径范围不符均阻塞交付。 |
| 效果确认（已发≠已生效） | 在候选 HEAD 上执行冻结测试及 canonical git diff 范围检查。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档契约缺项或范围越界 | 测试非零退出并阻塞交付 | 是 | 不降级 |

### 输入对抗面

N/A — 本任务不新增或修改对外 agent 输入面。

## Golden Path

独立小路（无父路）

[阅读说明] → [按鉴权创建运行] → [按 id 查询] → [识别派发失败回滚终态]

### Step 1: 找到中文桥接说明与两个端点用途
**来源**: `[FROM_PRD]` — 冻结 PRD「Golden Path」第 1 项与「范围限定」。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 存在，中文说明 POST 用于创建并派发一次运行，GET 用于按 id 查询运行状态。

**验证命令**: `npx vitest run sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts`

**硬阈值**: 文件存在；两个端点和各自用途逐字命中；测试 exit 0。

### Step 2: 按受保护方式鉴权
**来源**: `[FROM_PRD]` — 冻结 PRD「Golden Path」第 2 项。

**可观测行为**: 文档明确两个端点受 `internalAuthOrLoopback` 保护，宿主/远端必须携带 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`，且没有真实 token。

**验证命令**: `npx vitest run sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t '鉴权说明覆盖两个端点且不泄露凭据'`

**硬阈值**: 指定测试 exit 0。

### Step 3: 使用冻结的角色与 payload 契约
**来源**: `[FROM_PRD]` — 冻结 PRD「Golden Path」第 3、4 项；角色集合不得以生产代码观察替换。

**可观测行为**: 文档角色白名单严格且仅为 `planner`、`proposer`、`critic`、`generator`、`generator-fix`、`evaluator`、`evaluator-fix`、`merger`、`reporter`；payload 必填 `sprint_dir`、`base_repo`、`branch`，并说明 `base_sha` 可省略、由生产 Brain 自解析。

**验证命令**: `npx vitest run sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t '角色白名单严格等于冻结九项集合|payload 字段语义完整'`

**硬阈值**: 九项集合无缺失、无额外角色；payload 语义全部命中；测试 exit 0。

### Step 4: 识别失败回滚并约束变更范围
**来源**: `[FROM_PRD]` — 冻结 PRD「Golden Path」第 5 项与「范围限定」。

**可观测行为**: 文档明确 `run → failed`、`session → closed`、`task → cancelled`；相对冻结实现基线 `48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3`，排除本 Sprint 合同产物后仅新增目标文档。

**验证命令**: `bash -c 'ACTUAL=$(git diff --name-only 48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3 HEAD -- . ":(exclude)sprints/coding-harness-20260902104452-b4swl3/**"); [ "$ACTUAL" = "docs/current/attempt-run-bridge-guide.md" ] && npx vitest run sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "派发失败回滚三项终态"'`

**硬阈值**: canonical diff 输出恰为一行目标文档；回滚测试 exit 0。

## 真实调用方请求 shape

N/A — 本 Sprint 只写现有接口说明，不修改设备、agent 或服务端请求 shape；文档中的鉴权与字段严格来自冻结 PRD。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期或 DB 写边，N/A）

## 接缝清单

（本单无运行时真实世界接缝，N/A）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否错误暗示匿名或错误 Bearer 可访问。
- 重复提交: 检查九项角色是否重复后掩盖缺项。
- 中途中断: N/A，静态文档无异步流程。
- 边界值: 检查 `base_sha` 省略语义和非白名单角色拒绝语义。
发现分级: P0/P1 阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web（静态文档仓库验收，不启动 UI）

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3
SPRINT_DIR=sprints/coding-harness-20260902104452-b4swl3
DOC=docs/current/attempt-run-bridge-guide.md
test -f "$DOC"
npx vitest run "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts" --reporter=verbose
ACTUAL=$(git diff --name-only "$BASE_SHA" HEAD -- . ":(exclude)$SPRINT_DIR/**")
[ "$ACTUAL" = "$DOC" ] || { echo "FAIL: 越界文件: $ACTUAL"; exit 1; }
git diff --diff-filter=A --name-only "$BASE_SHA" HEAD -- "$DOC" | grep -qx "$DOC"
echo "OK: attempt-run 桥接文档合同验收通过"
```

## Test Contract

task_request_hash: 36b99953756db7bbfbaa29fd6871c56a549f04acbec458352388564d4538b039

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts` | `文档存在且为中文并说明两个端点用途`；`鉴权说明覆盖两个端点且不泄露凭据`；`角色白名单严格等于冻结九项集合`；`payload 字段语义完整`；`派发失败回滚三项终态` | 目标文档尚不存在，至少 5 个测试失败 |

## Notes

- contract-gate: 使用 Cecelia 仓内 `packages/brain/src/lib/contract-gate.js`；合同同时遵守 skill 内置规则。
- canonical 实现基线固定为 `48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3`，不得用角色 checkout SHA 替换。
