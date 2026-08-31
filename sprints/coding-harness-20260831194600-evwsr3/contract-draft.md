# Sprint Contract Draft (Round 1)

## 实现基线与证据

- 权威实现基线：`c04405fcfc1b5985b90273f52dbf0eee11b3888b`（来自 `inputs.implementation_baseline.base_sha`，不以本角色 checkout 或 registry revision 替换）。
- 权威代码：该基线的 `packages/brain/src/routes/harness-attempt-run.js` 导出九项 `ALLOWED_ROLES`，两个目标路由均挂载 `internalAuthOrLoopback`，派发异常路径执行三项回滚。
- Registry：API/DB/Test registry 可用，但其 `source_revision=88929fa377f5bed3cd1876a575c366ff1b93c0d5` 不是实现基线，仅作风格背景，不作合同事实来源。
- Unified Map：任务 payload 未配置 `map_scope/map_repo`，标记 `[MAP_NOT_CONFIGURED]`；无 `must_run_assertions`。
- contract-gate：启用（`packages/brain/src/lib/contract-gate.js` 存在）。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: N/A）

N/A — 本 Sprint 仅新增说明文档，不修改或验收 HTTP 响应实现；文档中的 API 名称及字段必须逐字服从 PRD与权威实现基线。

## 已知约束

- [`packages/brain/src/routes/__tests__/harness-attempt-run.test.js`] → 已有测试确认 `/attempt-run` 与 `/attempt-run/:attemptId` 路由注册并复用权威 `ALLOWED_ROLES`。
- [`packages/brain/src/middleware/internal-auth.test.js`] → 已有测试覆盖 loopback 与远端鉴权分流。
- [累积FR] 本 line 暂无历史。
- context-manifest：`journey_id=none`，无可查询的业务 line manifest。
- 唯一实现产物为 `docs/current/attempt-run-bridge-guide.md`；不得修改代码、既有文档或测试实现。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文说明，覆盖端点用途、鉴权、九项角色、payload 与失败回滚。 |
| NFR（做得多好） | 内容完整、与权威基线一致、不泄露真实凭据，唯一实现文件位于 `docs/current/`。 |
| Invariant（永不违反） | 不改代码；不硬编码 secret；不把受保护端点写成匿名远端可调用。 |
| 判定点（怎么知道） | Vitest 读取真实文档并逐节断言，另以 Git diff 锁定实现范围。 |
| 保质期（何时过期） | 权威端点合同变化时由维护者同步更新本页；当前锚定本合同实现基线。 |
| 死亡告警（停了谁知道） | 文档契约测试在 Sprint/回归 CI 失败即通知 PR 作者与维护者。 |
| 失败语义（挂了怎么办） | 任一内容或范围断言失败即阻塞交付，不降级放行。 |
| 效果确认（已发≠已生效） | 合并前读取提交树中的真实 Markdown，并对五类内容及唯一文件范围做断言。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节、角色增漏或语义错误 | 测试非零退出并阻塞交付 | 是，修正文档后重跑 | 无 |
| 实现 diff 出现文档外文件 | E2E 非零退出并阻塞交付 | 是，移除越界改动后重跑 | 无 |

### 输入对抗面

N/A — 不新增对外 agent 或可写接口。

## 禁 mock 边清单

（本单纯文档改动，不改调度、状态机、模块接缝或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 真实调用方请求 shape

N/A — 本 Sprint 不修改或执行调用方；文档只陈述 PRD 指定的鉴权与 payload 合同，不新增请求示例字段。

## Golden Path

独立小路（无父路）

操作者打开说明 → 理解提交和查询 → 核对鉴权与角色 → 准备 payload → 识别派发失败回滚结果。

### Step 1: 从中文说明识别两个桥接端点用途
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 项。

**可观测行为**: 同一中文页面明确说明 POST 用于提交、GET `:id` 用于查询。

**验证命令**: `npx vitest run sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts -t '中文文档说明提交与查询两个端点用途'`

**硬阈值**: 两个端点及用途全部命中，测试 exit 0。

### Step 2: 核对鉴权边界
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 项与「边界情况」。

**可观测行为**: 文档区分 loopback 与宿主/远端，后者明确要求 `Bearer CECELIA_INTERNAL_TOKEN`，不展示真实 token。

**验证命令**: `npx vitest run sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts -t '鉴权节区分 loopback 与宿主远端 Bearer 要求且不泄露凭据'`

**硬阈值**: 鉴权中间件名、两类调用方及变量名全部命中，测试 exit 0。

### Step 3: 核对九项角色白名单
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项；角色字面值取自权威实现基线的 `ALLOWED_ROLES`。

**可观测行为**: 文档按权威顺序恰好列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`。

**验证命令**: `npx vitest run sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts -t '角色白名单完整列出权威九项且无增漏'`

**硬阈值**: 数组逐项、顺序及数量完全相等，测试 exit 0。

### Step 4: 准备 payload
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项。

**可观测行为**: 文档将 `sprint_dir`、`base_repo`、`branch` 标为必填，并将 `base_sha` 标为可省略且由生产 Brain 自解析。

**验证命令**: `npx vitest run sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts -t 'payload 节区分三个必填字段与可省略 base_sha'`

**硬阈值**: 三个必填字段齐全，`base_sha` 不得被标成必填，测试 exit 0。

### Step 5: 识别派发失败后的自动回滚
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 项。

**可观测行为**: 文档在同一节明确给出 `run→failed`、`session→closed`、`task→cancelled`。

**验证命令**: `npx vitest run sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts -t '派发失败节完整说明三类资源自动回滚终态'`

**硬阈值**: 三类资源及目标终态全部命中，测试 exit 0。

### Step 6: 防止实现范围蔓延
**来源**: `[AI_ADDED]` — 将 PRD“严格不改代码、唯一实现产物”的边界转成不可绕过的机器断言。

**可观测行为**: 实现基线到候选提交之间仅新增目标说明文档；Sprint 合同产物不计入实现范围。

**验证命令**: `bash -c 'BAD=$(git diff --name-only c04405fcfc1b5985b90273f52dbf0eee11b3888b...HEAD -- . ":(exclude)sprints/coding-harness-20260831194600-evwsr3/**" | grep -v "^docs/current/attempt-run-bridge-guide.md$" || true); [ -z "$BAD" ]'`

**硬阈值**: 排除本 Sprint 冻结合同后，diff 文件集合完全等于目标文档，命令 exit 0。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api（纯文档工作区验收，不需要 Postgres 或应用进程）

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR='sprints/coding-harness-20260831194600-evwsr3'
BASE_SHA='c04405fcfc1b5985b90273f52dbf0eee11b3888b'
GUIDE='docs/current/attempt-run-bridge-guide.md'

npx vitest run "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts" --reporter=verbose
test -f "$GUIDE"
grep -qE '[一-龥]' "$GUIDE"
BAD=$(git diff --name-only "$BASE_SHA"...HEAD -- . ":(exclude)$SPRINT_DIR/**" | grep -v "^$GUIDE$" || true)
[ -z "$BAD" ] || { echo "FAIL: 实现范围越界: $BAD"; exit 1; }
COUNT=$(git diff --name-only "$BASE_SHA"...HEAD -- . ":(exclude)$SPRINT_DIR/**" | grep -c "^$GUIDE$")
[ "$COUNT" -eq 1 ] || { echo 'FAIL: 目标说明文档不是唯一实现产物'; exit 1; }
echo 'OK: attempt-run 桥接使用说明合同通过'
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 搜索是否把 `base_sha` 误写为必填，或把远端调用误写为免鉴权。
- 重复提交: N/A（纯文档）。
- 中途中断: N/A（纯文档）。
- 边界值: 人工对照权威基线核数九项角色，并检查无角色别名。
发现分级: P0/P1（泄密、鉴权误导、角色或回滚合同错误）阻塞 merge；P2/P3 记录 findings。

## 接缝清单

（纯文档交付，不碰真机、第三方 API、异步消息或生产 DB，N/A。）

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接中文说明 | `sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts` | 中文文档说明提交与查询两个端点用途；鉴权节区分 loopback 与宿主远端 Bearer 要求且不泄露凭据；角色白名单完整列出权威九项且无增漏；payload 节区分三个必填字段与可省略 base_sha；派发失败节完整说明三类资源自动回滚终态 | 目标文档尚不存在，5 个测试因 ENOENT 失败 |

