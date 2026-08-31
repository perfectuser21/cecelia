# Sprint Contract Draft (Round 1)

## 合同基线与范围

- 权威实现基线：`f4f1f511f854ec6fdc0a8512bfe9183181be3fb9`（来自 `inputs.implementation_baseline.base_sha`，不以角色 checkout 或 PRD 内旧假设替换）。
- 唯一实现产物：`docs/current/attempt-run-bridge-guide.md`。
- 禁止修改生产代码、API、鉴权、角色白名单、数据库或运行配置。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- gp-anchor: skipped (product-map.json not found)
- Unified Map: `[MAP_NOT_CONFIGURED]`；本 task 未提供 `map_scope/map_repo`，无 `must_run_assertions`。

## Response Schema（推导来源: PRD字面）

N/A — 本任务只新增说明文档，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试）

- `[packages/brain/src/routes/__tests__/harness-attempt-run.test.js]` → 角色白名单封闭：包含九个执行角色，永不包含 commander/publisher。
- `[tests/gp/f1/step3-attempt-run-endpoint.test.js]` → POST 创建派发、GET 查询、派发失败回滚与终态收尾均已有回归约束。
- `[累积FR]` → 本 line 暂无历史。
- `[实现源码]` → `ALLOWED_ROLES` 精确为 canary、planner、proposer、reviewer、generator、generator-fix、evaluator、evaluator-evidence-repair、judge。

## Golden Path

独立小路（无父路）

阅读说明 → 选择创建或查询端点 → 配置鉴权与 payload → 理解派发失败收敛状态

### Step 1: 读者识别创建与查询端点
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 项。

**可观测行为**: 中文文档的「端点用途」节明确 POST 用于创建并派发，GET 用于按 id 查询运行状态。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-guide.test.ts -t '两个端点用途与 internalAuthOrLoopback 鉴权说明完整'`

**硬阈值**: 两个端点字面与用途断言全部通过；验证命令 exit 0。

### Step 2: 读者正确区分 loopback 与宿主/远端鉴权
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 2 项与「边界情况」第 1 项。

**可观测行为**: 「鉴权方式」节写明 `internalAuthOrLoopback`，并明确宿主/远端使用 `Authorization: Bearer CECELIA_INTERNAL_TOKEN`，不把 loopback 条件误写成远端免鉴权。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-guide.test.ts -t '两个端点用途与 internalAuthOrLoopback 鉴权说明完整'`

**硬阈值**: 鉴权中间件、Bearer 写法、宿主/远端和 loopback 四项同时命中；验证命令 exit 0。

### Step 3: 读者取得完整角色与 payload 规则
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 3 项。

**可观测行为**: 「角色白名单与 payload」节逐项列出九个角色，标出 `sprint_dir`、`base_repo`、`branch` 必填，并说明 `base_sha` 可省略且由生产 Brain 自解析。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-guide.test.ts -t '角色白名单精确列出九项且 payload 必填与 base_sha 省略语义正确'`

**硬阈值**: 九项角色集合精确、三个必填字段齐全、base_sha 省略语义正确；验证命令 exit 0。

### Step 4: 读者理解派发失败的完整回滚
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 4 项。

**可观测行为**: 「派发失败自动回滚」节同时写明 `run → failed`、`session → closed`、`task → cancelled`，说明系统已收敛而非仍在执行。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-guide.test.ts -t '派发失败回滚同时收敛 run session task 三类状态'`

**硬阈值**: 三类对象及其终态全部命中；验证命令 exit 0。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接说明，覆盖 PRD 四节。 |
| NFR（做得多好） | 冻结 Vitest 精确读取真实文档并验证四节、九角色及关键字面。 |
| Invariant（永不违反） | 仅新增目标文档；权威实现基线保持 `f4f1f511f854ec6fdc0a8512bfe9183181be3fb9`。 |
| 判定点（怎么知道） | 见下方登记表；本任务无外部状态推断。 |
| 保质期（何时过期） | 角色、端点、鉴权或 payload 实现变化时，文档与冻结测试须同 PR 更新。 |
| 死亡告警（停了谁知道） | Sprint Tests 读取不到文档或关键语义漂移即 CI 失败。 |
| 失败语义（挂了怎么办） | 缺节、缺角色或语义错误均阻塞交付，不降级放行。 |
| 效果确认（已发≠已生效） | 从仓库真实文档读取内容并由 Vitest 四项断言确认。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或内容不完整 | Vitest 非零退出，阻塞合并 | 是，补正文后可重复执行 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入处理面。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 本任务描述既有端点但不改调用协议；冻结测试只验证说明文档，不构造新的生产调用路径。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本任务仅交付静态说明文档，无真实世界接缝，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否把非法角色或缺失必填字段误写成可接受。
- 重复提交: N/A，静态文档无提交动作。
- 中途中断: N/A，静态文档无运行中状态。
- 边界值: 检查九项角色是否存在前缀互相误计数，尤其 generator 与 generator-fix。
发现分级: P0/P1（误导调用方或遗漏失败收敛）阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR='sprints/coding-harness-20260831174800-fxqhpa'
DOC='docs/current/attempt-run-bridge-guide.md'
test -f "$DOC"
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts" --reporter=verbose
CHANGED=$(git diff --name-only f4f1f511f854ec6fdc0a8512bfe9183181be3fb9...HEAD)
PROD_CHANGED=$(printf '%s\n' "$CHANGED" | grep -Ev '^(docs/current/attempt-run-bridge-guide\.md|sprints/coding-harness-20260831174800-fxqhpa/)' || true)
[ -z "$PROD_CHANGED" ] || { echo "FAIL: 检测到范围外文件: $PROD_CHANGED"; exit 1; }
echo 'OK: attempt-run 桥接说明 Golden Path 验证通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-guide.test.ts` | 文档存在于 docs/current 且包含中文四节；两个端点用途与 internalAuthOrLoopback 鉴权说明完整；角色白名单精确列出九项且 payload 必填与 base_sha 省略语义正确；派发失败回滚同时收敛 run session task 三类状态 | 目标文档尚不存在，4 tests failed |
