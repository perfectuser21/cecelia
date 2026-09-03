# Sprint Contract Draft (Round 1)

## 基线与范围

- 实现基线：`565796b924487f6d5c4314703c757b32b788fdac`（来自 `inputs.implementation_baseline.base_sha`）。
- 唯一允许的实现产物：`docs/current/attempt-run-bridge-usage.md`。
- canonical 范围 oracle：`git diff --name-only --diff-filter=ACMR "$BASE_SHA...HEAD"`；执行时 `BASE_SHA` 必须等于上述实现基线。
- `[MAP_NOT_CONFIGURED]`：task payload 未提供可用的 `map_scope`/`map_repo` 字符串，故无 `must_run_assertions`、fact revisions 或 freshness 可纳入。
- contract-gate：启用（`packages/brain/src/lib/contract-gate.js` 存在）。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: N/A）

N/A — 本任务仅新增说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → 生产路由注册 `/attempt-run` 与 `/attempt-run/:attemptId`。
- [packages/brain/src/middleware/internal-auth.test.js] → `internalAuthOrLoopback` 区分 loopback 与非 loopback 请求。
- [累积FR] 本 line 暂无历史。
- context-manifest: journey_id 为 none，不适用。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文说明，覆盖两端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 名称逐字准确；不出现真实凭据；范围只含一份 `docs/current/` 文档。 |
| Invariant（永不违反） | 不改代码；不硬编码凭据；不暗示远端匿名访问。 |
| 判定点（怎么知道） | 由冻结 Vitest 对封闭集合、正负 oracle 与 canonical diff 机检。 |
| 保质期（何时过期） | 生产端点、鉴权、角色或 payload 合同变化时由对应维护者同步更新。 |
| 死亡告警（停了谁知道） | Sprint Tests/合同验收失败即阻塞合并，由 PR 维护者获知。 |
| 失败语义（挂了怎么办） | 任一内容或范围断言失败即阻塞，不放行。 |
| 效果确认（已发≠已生效） | 从基线到候选 HEAD 的 diff 中目标文档唯一新增，且全部内容断言通过。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节、枚举不精确或范围越界 | Vitest 非零退出并阻塞合并 | 是 | 无降级，不接受部分成功 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入入口。

## Golden Path

独立小路（无父路）

[维护者打开说明] → [按文档鉴权创建 attempt] → [按 id 查询] → [识别失败回滚终态]

### Step 1: 找到创建与查询入口
**来源**: `[FROM_PRD]` — thin PRD 第 1 项。

**可观测行为**: 文档分别说明 POST 创建并派发角色执行、GET 按 id 查询状态。

**验证命令**: `BASE_SHA=565796b924487f6d5c4314703c757b32b788fdac npx vitest run --no-cache sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-bridge-usage.test.ts -t '文档包含创建与查询端点的准确用途'`

**硬阈值**: 两个端点及用途断言全部通过，负向缺失端点样本必须被拒绝；命令 exit 0。

### Step 2: 正确鉴权并选择合法角色
**来源**: `[FROM_PRD]` — thin PRD 第 1、2 项。

**可观测行为**: 文档明确 loopback 中间件名称、远端 Bearer 要求，并以九行列出生产角色封闭集合。

**验证命令**: `BASE_SHA=565796b924487f6d5c4314703c757b32b788fdac npx vitest run --no-cache sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-bridge-usage.test.ts -t '鉴权说明|角色白名单'`

**硬阈值**: 角色数组逐项且顺序完全等于九项封闭集合；别名、遗漏、匿名远端样本均被拒绝；命令 exit 0。

### Step 3: 构造最小 payload
**来源**: `[FROM_PRD]` — thin PRD 第 3 项。

**可观测行为**: 文档将 `sprint_dir`、`base_repo`、`branch` 标为必填，并说明 `base_sha` 可省略且由生产 Brain 自解析。

**验证命令**: `BASE_SHA=565796b924487f6d5c4314703c757b32b788fdac npx vitest run --no-cache sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-bridge-usage.test.ts -t 'payload 明确三个必填字段'`

**硬阈值**: 四字段与省略语义均通过，调用方猜固定值的负向样本被拒绝；命令 exit 0。

### Step 4: 识别派发失败后的完整终态
**来源**: `[FROM_PRD]` — thin PRD 第 4 项。

**可观测行为**: 文档把失败描述为三类关联资源全部进入终态，而非部分成功。

**验证命令**: `BASE_SHA=565796b924487f6d5c4314703c757b32b788fdac npx vitest run --no-cache sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-bridge-usage.test.ts -t '派发失败回滚完整列出三个资源终态'`

**硬阈值**: `run→failed`、`session→closed`、`task→cancelled` 全部出现，任一遗漏样本被拒绝；命令 exit 0。

### Step 5: 确认只新增说明文档
**来源**: `[FROM_PRD]` — thin PRD 的“不修改代码”范围要求。

**可观测行为**: 相对冻结实现基线，Sprint 合同产物之外唯一变化是目标文档。

**验证命令**: `BASE_SHA=565796b924487f6d5c4314703c757b32b788fdac npx vitest run --no-cache sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-bridge-usage.test.ts -t '范围 oracle 仅允许新增目标文档'`

**硬阈值**: canonical diff 精确等于 `docs/current/attempt-run-bridge-usage.md`，注入代码路径的负向样本被拒绝；命令 exit 0。

## 真实调用方请求 shape

N/A — 本 Sprint 不修改或调用生产端点，仅记录现有使用说明。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块、生命周期或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本单纯文档改动，无真实世界接缝，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例未把错误 Bearer 写成可接受输入。
- 重复提交: N/A，文档不执行提交。
- 中途中断: N/A，静态文档无运行态。
- 边界值: 对九角色逐行核对别名、遗漏与额外角色。
发现分级: P0/P1（泄漏凭据、暗示绕过鉴权或错误回滚）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
: "${BASE_SHA:?Runner must inject the frozen implementation BASE_SHA}"
[ "$BASE_SHA" = "565796b924487f6d5c4314703c757b32b788fdac" ]
npx vitest run --no-cache sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-bridge-usage.test.ts
CHANGED=$(git diff --name-only --diff-filter=ACMR "$BASE_SHA...HEAD" | grep -v '^sprints/coding-harness-20260903182810-fojc1r/' || true)
[ "$CHANGED" = "docs/current/attempt-run-bridge-usage.md" ] || { echo "FAIL: scope=$CHANGED"; exit 1; }
git diff --name-only "$BASE_SHA...HEAD" | grep -Eq '^packages/.*/src/' && { echo 'FAIL: 检出代码变化'; exit 1; } || true
echo 'OK: attempt-run 桥接说明及范围验收通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 说明文档完整性与范围 | `sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-bridge-usage.test.ts` | `文档包含创建与查询端点的准确用途`；`鉴权说明要求宿主或远端使用 Bearer token`；`角色白名单是九项封闭集合且拒绝别名和遗漏`；`payload 明确三个必填字段与 base_sha 省略语义`；`派发失败回滚完整列出三个资源终态`；`范围 oracle 仅允许新增目标文档且拒绝代码变化` | 目标文档尚不存在，至少 5 个读取文档的测试失败 |

## Notes

- 本合同只约束文档交付；不要求修改路由、鉴权、数据库或测试运行逻辑。
- GAN authoring identity 不固化进未来验收；执行身份保持 Runner late-bound。
