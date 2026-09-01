# Sprint Contract Draft (Round 1)

## Notes

- 权威实现基线：`5599211397c88c3827d5ce4e9c6061b3802b4fc5`；角色工作区基线不替换该值。
- `[MAP_NOT_CONFIGURED]`：task payload 未提供可用的 `map_scope`/`map_repo`，不猜测 Unified Map 半径；`must_run_assertions` 为空。
- `context-manifest: unavailable`：`journey_id=none`，无可解析的累积 FR 端点。
- `gp-anchor: skipped (product-map.json not found)`。
- Contract Gate：`packages/brain/src/lib/contract-gate.js` 存在，按 Cecelia 合同闸规则验收。
- PRD 与当前实现存在角色名差异；本冻结合同按 PRD 明列九项写文档与验收，不授权修改接口代码。

## Response Schema（推导来源: N/A）

N/A — 本任务只新增既有 HTTP 接口的中文说明，不新增或改变 HTTP 响应。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 路由同时注册 `/attempt-run` 与 `/attempt-run/:attemptId`。
- `packages/brain/src/middleware/internal-auth.test.js` → `internalAuthOrLoopback` 区分 loopback 与远端 Bearer 鉴权。
- `[累积FR] context-manifest: unavailable`（journey_id 为 none）。
- Unified Map `must_run_assertions`：空（map 未配置）。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/` 新增中文 attempt-run 桥接说明，覆盖端点、鉴权、九角色、payload 和失败回滚。 |
| NFR（做得多好） | 名称字面准确；不写真实凭据；产品 diff 只有目标文档。 |
| Invariant（永不违反） | 不改代码；不暴露 token；远端鉴权不得描述为可省略。 |
| 判定点（怎么知道） | 由冻结 Vitest 与 E2E 对文档内容及实现基线 diff 作确定性判断。 |
| 保质期（何时过期） | 接口合同变化时由接口维护者同步更新本页。 |
| 死亡告警（停了谁知道） | Sprint Tests/合同 E2E 在文档缺失或约定漂移时立即非零退出。 |
| 失败语义（挂了怎么办） | 任一内容或范围断言失败即阻塞交付，不降级放行。 |
| 效果确认（已发≠已生效） | 从实现基线读取真实 Git diff，并逐项解析最终文档。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或字面值错误 | 测试非零退出，阻塞交付 | 是，修正文档后重跑 | 无 |
| 产品 diff 出现代码或额外文件 | 测试非零退出，阻塞交付 | 是，移除越界改动后重跑 | 无 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或可写接口。

## Golden Path

独立小路（无父路）

[阅读说明] → [确认鉴权与角色] → [构造 payload] → [查询状态或识别失败回滚]

### Step 1: 读者识别两个桥接端点及鉴权

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1-2 项。

**可观测行为**: 中文文档分别说明 POST 派发、GET 按 id 查询，并明确远端携带 `Bearer CECELIA_INTERNAL_TOKEN`。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts -t '中文文档包含两个端点用途与鉴权规则'`

**硬阈值**: 两个端点、`internalAuthOrLoopback`、Bearer 变量名全部命中且测试 exit 0。

### Step 2: 读者确认九项角色白名单

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项。

**可观测行为**: 文档逐项列出 planner、proposer、skeptic、generator、generator-fix、evaluator、judge、reporter、controller。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts -t '角色白名单逐项列出九个 PRD 角色'`

**硬阈值**: 九项逐字命中且测试 exit 0。

### Step 3: 读者区分 payload 必填与可选字段

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项。

**可观测行为**: `sprint_dir`、`base_repo`、`branch` 明确标为必填；`base_sha` 明确可省略并由生产 Brain 自解析。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts -t 'payload 区分三个必填字段与可省略 base_sha'`

**硬阈值**: 三个必填与一个可选语义全部命中且测试 exit 0。

### Step 4: 读者识别派发失败的完整回滚终态

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 项。

**可观测行为**: 文档明确 run → failed、session → closed、task → cancelled。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts -t '派发失败说明完整回滚三个对象终态'`

**硬阈值**: 三对象三终态全部命中且测试 exit 0。

### Step 5: 确认交付不越过文档范围

**来源**: `[AI_ADDED]` — 将 PRD「不改任何代码」转成相对冻结实现基线的防越界 oracle。

**可观测行为**: 排除本 sprint 合同产物后，产品 diff 只有 `docs/current/attempt-run-bridge-guide.md`。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts -t '实现基线之外的产品改动只有目标文档'`

**硬阈值**: 文件列表严格等于目标文档且测试 exit 0。

## 真实调用方请求 shape

N/A — 本任务不新增或调用接口，只说明既有接口。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本任务没有需要在真机或生产环境执行的接缝；文档内容与 Git diff 均为本地确定性验证，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误把 `base_sha` 写成必填。
- 重复提交: 检查九角色是否重复、漏项或出现第十项。
- 中途中断: N/A，静态文档无运行中状态。
- 边界值: 检查宿主/远端与 loopback 的鉴权边界是否清楚。
发现分级: P0/P1（凭据泄露、远端鉴权错误、接口合同错误）阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web（文档仓库验收，不启动 UI）

```bash
#!/bin/bash
set -euo pipefail
BASELINE=5599211397c88c3827d5ce4e9c6061b3802b4fc5
SPRINT_DIR=sprints/coding-harness-20260901070958-avqlef
GUIDE=docs/current/attempt-run-bridge-guide.md
test -f "$GUIDE"
grep -qE '[一-龥]' "$GUIDE"
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts"
PRODUCT_FILES=$(git diff --name-only "$BASELINE" -- . ":(exclude)$SPRINT_DIR/**")
[ "$PRODUCT_FILES" = "$GUIDE" ]
echo 'attempt-run 桥接说明 E2E 通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 端点与鉴权 | `sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts` | 中文文档包含两个端点用途与鉴权规则 | 目标文档尚不存在，读取抛出 ENOENT |
| 角色白名单 | `sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts` | 角色白名单逐项列出九个 PRD 角色 | 目标文档尚不存在，测试失败 |
| payload 与回滚 | `sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts` | payload 区分三个必填字段与可省略 base_sha；派发失败说明完整回滚三个对象终态 | 目标文档尚不存在，测试失败 |
| 范围限定 | `sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts` | 实现基线之外的产品改动只有目标文档 | 尚无唯一目标文档产品 diff，测试失败 |
