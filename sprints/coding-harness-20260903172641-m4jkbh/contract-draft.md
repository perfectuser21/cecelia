# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应变更；本 Sprint 只新增说明文档，不改变两个既有端点的响应契约。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → `ALLOWED_ROLES` 与 `/attempt-run`、`/attempt-run/:attemptId` 路由已由既有测试锁定。
- [累积FR] 本 line 暂无历史。
- context-manifest: journey_id 为 `none`，无可查询的 line manifest。
- [MAP_NOT_CONFIGURED] task payload 未提供可用的 map_scope/map_repo；不使用领域硬编码回退。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)。
- gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增 `docs/current/attempt-run-bridge-usage.md`，准确说明端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 中文；四节齐全；关键字面均由冻结 Vitest 确定性断言。 |
| Invariant（永不违反） | 不改代码；不硬编码 token 值；不把 loopback 例外写成宿主/远端免鉴权。 |
| 判定点（怎么知道） | 以生产路由 `ALLOWED_ROLES` 与 PRD 字面为权威，闭集/正负 oracle 验收。 |
| 保质期（何时过期） | 路由、角色、payload 或回滚语义变化时由改动者同步更新本文档。 |
| 死亡告警（停了谁知道） | Sprint Tests 的冻结测试在文档缺失或契约漂移时立即失败并阻塞 CI。 |
| 失败语义（挂了怎么办） | 任一必需字面缺失、出现越界角色/字段或范围越界均 fail-closed。 |
| 效果确认（已发≠已生效） | Vitest 读取已提交文档并验证闭集；git diff 从冻结基线验证唯一产品产物。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或契约不完整 | 测试非零退出并阻塞交付 | 是 | 无降级，不接受部分说明 |
| 出现额外角色或把 `base_sha` 写成必填 | 测试非零退出并阻塞交付 | 是 | 修正文档后重跑 |
| 产品改动路径越界 | scope oracle 非零退出并阻塞交付 | 是 | 删除越界改动 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或可写接口。

## Golden Path

独立小路（无父路）

[阅读说明] → [确认端点与鉴权] → [按九角色和 payload 组装请求] → [查询结果并理解失败回滚]

### Step 1: 找到并阅读中文桥接说明

**来源**: `[FROM_PRD]` — `Golden Path（核心场景）` 与范围限定要求在 `docs/current/` 新增中文说明。

**可观测行为**: `docs/current/attempt-run-bridge-usage.md` 存在、含中文且恰有四个主题节。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260903172641-m4jkbh/tests/attempt-run-bridge-usage.test.ts -t '中文文档存在且四节齐全'
```

**硬阈值**: exit code = 0；正向断言四节全部存在，负向断言英文占位文档或额外主题节不能通过。

### Step 2: 明确两个端点用途与鉴权边界

**来源**: `[FROM_PRD]` — Golden Path 第 1、2 项及边界情况明确规定端点用途与鉴权。

**可观测行为**: 文档逐字写明 POST 创建/派发、GET 按 id 查询，以及 loopback 与宿主/远端 Bearer 要求的区别。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260903172641-m4jkbh/tests/attempt-run-bridge-usage.test.ts -t '两个端点用途与鉴权边界'
```

**硬阈值**: exit code = 0；每个正向字面有缺失/错误鉴权描述的负向 oracle。

### Step 3: 使用封闭九角色集合与 payload 契约

**来源**: `[FROM_PRD]` — Golden Path 第 3 项要求完整九项角色及 payload 必填/可省略语义。

**可观测行为**: 白名单逐项且仅列 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`；必填字段仅 `sprint_dir`、`base_repo`、`branch`，`base_sha` 明确可省略并由生产 Brain 自解析。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260903172641-m4jkbh/tests/attempt-run-bridge-usage.test.ts -t '九项角色是封闭集合且 payload 必填集合准确'
```

**硬阈值**: exit code = 0；集合严格相等，额外角色、缺角色、把 `base_sha` 归入必填均由负向 oracle 拒绝。

### Step 4: 理解派发失败的原子回滚终态

**来源**: `[FROM_PRD]` — Golden Path 第 4 项要求三个对象及终态同时出现。

**可观测行为**: 文档明确派发失败自动回滚为 `run→failed`、`session→closed`、`task→cancelled`。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260903172641-m4jkbh/tests/attempt-run-bridge-usage.test.ts -t '派发失败三段回滚终态完整'
```

**硬阈值**: exit code = 0；三项严格集合相等，缺一项或增加其他终态均由负向 oracle 拒绝。

### Step 5: 证明实现范围只有指定文档

**来源**: `[AI_ADDED]` — 将 PRD“不改任何代码”和任务要求的 coding-contract canonical git-diff 范围 oracle 固化，防止合同/测试产物干扰产品范围判定。

**可观测行为**: 相对冻结实现基线的非 Sprint 产物变更只有 `docs/current/attempt-run-bridge-usage.md`。

**验证命令**:
```bash
BASE_SHA='7404b42722835094b457b55f092cd76139ce131e'; ALLOWED='docs/current/attempt-run-bridge-usage.md'; ACTUAL=$(git diff --name-only "$BASE_SHA"...HEAD -- . ':(exclude)sprints/**'); [ "$ACTUAL" = "$ALLOWED" ]
```

**硬阈值**: exit code = 0；正向只接受唯一允许路径，负向通过严格字符串相等拒绝任意额外、缺失或代码路径。

## 禁 mock 边清单

（本单纯文档改动，无调度、状态机、跨模块传递、生命周期或 DB 写路径改动，N/A。）

## 真实调用方请求 shape

N/A — 本 Sprint 不发真实请求、不改变调用 shape；文档只陈述既有 POST/GET 调用约束。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 接缝清单

（纯文档交付，无真实世界接缝，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否错误暗示远端可省略 Bearer。
- 重复提交: 检查角色或必填字段是否在不同章节出现冲突定义。
- 中途中断: N/A，静态文档无运行中状态。
- 边界值: 检查白名单恰为九项，`base_sha` 未混入必填集合。
发现分级: P0/P1（凭据泄漏、远端鉴权误导）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
BASE_SHA='7404b42722835094b457b55f092cd76139ce131e'
DOC='docs/current/attempt-run-bridge-usage.md'
TEST='sprints/coding-harness-20260903172641-m4jkbh/tests/attempt-run-bridge-usage.test.ts'
npx vitest run --no-cache "$TEST" --reporter=verbose
ALLOWED="$DOC"
ACTUAL=$(git diff --name-only "$BASE_SHA"...HEAD -- . ':(exclude)sprints/**')
[ "$ACTUAL" = "$ALLOWED" ] || { echo "FAIL: 产品范围越界或文档缺失: $ACTUAL"; exit 1; }
git diff --name-only "$BASE_SHA"...HEAD -- 'packages/**' 'apps/**' 'scripts/**' | (! read -r _)
echo 'OK: attempt-run 桥接文档合同通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 文档完整性 | `sprints/coding-harness-20260903172641-m4jkbh/tests/attempt-run-bridge-usage.test.ts` | `中文文档存在且四节齐全`、`两个端点用途与鉴权边界`、`九项角色是封闭集合且 payload 必填集合准确`、`派发失败三段回滚终态完整`、`实现范围仅允许指定文档` | 文档尚不存在，5 个 `it()` 均因读取/存在性断言失败 |

## Notes

- implementation baseline 固定为 `7404b42722835094b457b55f092cd76139ce131e`；不以角色 checkout SHA 替换。
- 本任务纯文档，不执行或修改现有端点，不需要 staging 预览闸。
