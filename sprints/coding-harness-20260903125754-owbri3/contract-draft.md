# Sprint Contract Draft (Round 1)

## 合同基线与证据

- authoritative implementation baseline: `b99c580d7fe8ca4cbf0ee834e13c91df02b57369`（来自 task bundle `inputs.implementation_baseline.base_sha`；所有范围 oracle 固定使用此 SHA，不以 role checkout SHA 或 registry revision 替换）。
- PRD/registry 提到的 `7984b6cfb5fd43294ece90d20257434dc917903c` 仅作为服务端白名单与技术事实证据版本，不作为实现 diff 基线。
- api/db/test registry：fresh，source revision `7984b6cfb5fd43294ece90d20257434dc917903c`；API registry 用于核对现有端点风格，DB registry 对 docs-only 任务 N/A，测试采用 registry 所示 Vitest 风格。
- Unified Map: `[MAP_NOT_CONFIGURED]`（task payload 未提供有效 map_scope/map_repo；must_run_assertions 为空）。
- context-manifest: unavailable（journey_id 为 `none`，端点无可用 manifest）。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD字面）

N/A — 本 Sprint 只新增使用说明，不新增或修改 HTTP 响应。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → `角色白名单封闭：包含九个执行角色，永不包含 commander/publisher`
- [累积FR] 本 line 暂无历史。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接说明，覆盖端点、鉴权、九角色、payload 与回滚链。 |
| NFR（做得多好） | 内容可由冻结 Vitest 与固定基线 diff 机械核验；不写真实凭据。 |
| Invariant（永不违反） | 不修改产品代码/配置/API；远端鉴权不得写成可免；九角色集合不得增删。 |
| 判定点（怎么知道） | 见下方登记表。 |
| 保质期（何时过期） | 与实现基线白名单及 attempt-run 路由同步；路由契约变化时由维护者更新。 |
| 死亡告警（停了谁知道） | 冻结合同测试或范围 oracle 在 CI 失败即通知 PR 作者。 |
| 失败语义（挂了怎么办） | 任一内容、封闭集合或范围断言失败均阻塞交付。 |
| 效果确认（已发≠已生效） | 以文档内容解析、负向变异拒绝和固定基线 diff 三类回执确认。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或字段错误 | 测试非零退出并阻塞 | 是 | 不降级 |
| 九角色集合漂移 | 封闭集合断言失败并阻塞 | 是 | 不使用“等”替代 |
| 范围出现产品代码/配置 | 固定基线 diff 断言失败并阻塞 | 是 | 不降级 |

### 输入对抗面

N/A — 本 Sprint 不新增或修改对外 agent 接口，仅编写说明文档。

## 真实调用方请求 shape

- `POST /api/brain/harness/attempt-run`：生产路由由 `internalAuthOrLoopback` 保护；宿主/远端使用 `Authorization: Bearer CECELIA_INTERNAL_TOKEN`；请求体包含 `role`，且 `payload` 内含 `sprint_dir`、`base_repo`、`branch`，`base_sha` 可省略由生产 Brain 自解析。
- `GET /api/brain/harness/attempt-run/:id`：路径参数 `id` 为 attempt 标识；采用同一鉴权方式。本 Sprint 只如实记录 shape，不发起 API 或改变接口。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、模块接缝或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本任务只验证静态中文文档，不触及真机、异步消息或第三方 API，N/A。）

## Golden Path

独立小路（无父路）

[阅读说明] → [区分创建与查询] → [按鉴权和 payload 调用] → [识别成功状态或失败回滚]

### Step 1: 读者找到中文桥接说明并区分两个端点
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1、6 项。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 具有中文标题与“端点用途”节，分别把 POST 说明为创建、GET 说明为查询。

**验证命令**: `npx vitest run sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts -t '端点用途与鉴权正负 oracle'`

**硬阈值**: 命令 exit 0；两个端点及用途断言全部通过，删除或错配任一关键字的负向变异必须被拒绝。

### Step 2: 读者取得正确鉴权与封闭九角色集合
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 2、3 项及「边界情况」。

**可观测行为**: 文档区分回环与宿主/远端鉴权，并逐项列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，恰好九项。

**验证命令**: `npx vitest run sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts -t '角色白名单恰好九项封闭集合正负 oracle'`

**硬阈值**: 命令 exit 0；集合与实现定义按顺序完全相等，增加、删除、重复均失败。

### Step 3: 读者正确填写 payload
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 4 项。

**可观测行为**: 文档把 `sprint_dir`、`base_repo`、`branch` 标成必填，把 `base_sha` 标成可省略并说明由生产 Brain 自解析。

**验证命令**: `npx vitest run sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts -t 'payload 必填与 base_sha 可省略正负 oracle'`

**硬阈值**: 命令 exit 0；三项必填全部命中，`base_sha` 误写必填的负向变异必须失败。

### Step 4: 读者确认派发失败回滚链
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 5 项。

**可观测行为**: 文档逐字展示 `run→failed/session→closed/task→cancelled`。

**验证命令**: `npx vitest run sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts -t '派发失败回滚链正负 oracle'`

**硬阈值**: 命令 exit 0；链条必须逐字完整，改变任一终态的负向变异必须失败。

### Step 5: 交付保持 docs-only 范围
**来源**: `[AI_ADDED]` — 把 PRD“仅新增一页文档、不改代码”转成固定实现基线的防越界 oracle。

**可观测行为**: 排除本 Sprint 合同产物后，implementation diff 恰好只有 `docs/current/attempt-run-bridge-guide.md`。

**验证命令**: `BASE_SHA='b99c580d7fe8ca4cbf0ee834e13c91df02b57369'; CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD -- . ':(exclude)sprints/coding-harness-20260903125754-owbri3/**'); [ "$CHANGED" = 'docs/current/attempt-run-bridge-guide.md' ]`

**硬阈值**: 命令 exit 0；新增任一产品代码、测试、配置或第二份文档均失败。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA='b99c580d7fe8ca4cbf0ee834e13c91df02b57369'
SPRINT_DIR='sprints/coding-harness-20260903125754-owbri3'
DOC='docs/current/attempt-run-bridge-guide.md'
npx vitest run "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts" --reporter=verbose
CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD -- . ":(exclude)$SPRINT_DIR/**")
[ "$CHANGED" = "$DOC" ] || { echo "FAIL: implementation diff 越界: $CHANGED"; exit 1; }
git diff -- "$DOC" | grep -q 'attempt-run 桥接使用说明' || { echo 'FAIL: 文档标题不存在于本轮 diff'; exit 1; }
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例是否会把 `base_sha` 误导为必填。
- 重复提交: 检查角色列表是否含重复项或“等”造成开放集合。
- 中途中断: N/A（静态文档无运行中状态）。
- 边界值: 检查九角色集合增加、缺失、重复以及回滚链缺段。
发现分级: P0/P1（真实凭据泄露、远端鉴权误导、范围越界）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 端点与鉴权 | `sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts` | `端点用途与鉴权正负 oracle` | 文档尚不存在，readFileSync 抛 ENOENT |
| 九角色封闭集合 | `sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts` | `角色白名单恰好九项封闭集合正负 oracle` | 文档尚不存在，readFileSync 抛 ENOENT |
| payload 规则 | `sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts` | `payload 必填与 base_sha 可省略正负 oracle` | 文档尚不存在，readFileSync 抛 ENOENT |
| 回滚链 | `sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts` | `派发失败回滚链正负 oracle` | 文档尚不存在，readFileSync 抛 ENOENT |
| docs-only 范围 | `sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts` | `范围仅新增一份 docs/current 中文文档正负 oracle` | implementation diff 尚无目标文档，集合断言失败 |
