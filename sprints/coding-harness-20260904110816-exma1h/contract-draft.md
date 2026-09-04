# Sprint Contract Draft（Round 1）

## 合同边界

- 实现基线（冻结）：`e0a56e2efaa96a5e9b1759f6b1086282121454dd`。所有范围断言必须以此 `BASE_SHA` 比较候选 `HEAD`，不得改用 checkout 基线或 merge-base。
- 唯一实现产物：`docs/current/attempt-run-bridge-usage.md`，新增中文 Markdown 文档；不得修改任何代码、配置、既有文档或 Sprint 管理文件。
- `[MAP_NOT_CONFIGURED]`：任务未提供可用的 Unified Map scope/repo，故无 `must_run_assertions`；不以领域硬编码替代。
- gp-anchor: skipped (product-map.json not found)
- Contract Gate：适用（`packages/brain/src/lib/contract-gate.js` 存在）。

## Response Schema（推导来源: PRD字面）

N/A — 本 Sprint 只新增使用说明，不新增或修改 HTTP 响应。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → 角色白名单封闭：包含九个执行角色，永不包含 commander/publisher。
- [packages/brain/src/middleware/internal-auth.test.js] → 未配置 token 时仅回环来源可放行；配置 token 后请求必须提交正确 Bearer token。
- [累积 FR] 本 line 暂无历史。
- context-manifest: journey_id=none，无可加载的业务路径清单。
- [Invariant 端点鉴权] 文档必须准确说明现有 `internalAuthOrLoopback`，不得承诺匿名非回环访问。
- [Invariant 分支权威] 本合同只描述产品 API，不改变 Planner 分支权威。
- [Invariant 凭据隔离] 文档只引用环境变量名，不展示、复制或记录 token 值。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接使用说明，覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 精确字面量、九角色精确同集、范围仅一份新增 Markdown。 |
| Invariant（永不违反） | 不改运行时代码；不泄露 token；非回环请求不得被描述为免鉴权。 |
| 判定点（怎么知道） | 以生产 `ALLOWED_ROLES` 源码集合及冻结基线 diff 为权威。 |
| 保质期（何时过期） | 当端点、鉴权、角色或 payload 契约变化时由对应代码变更同步更新本文。 |
| 死亡告警（停了谁知道） | 冻结测试在 Sprint Tests/合同封印中失败并阻断交付。 |
| 失败语义（挂了怎么办） | 任一内容或范围断言失败即拒绝交付，不降级放行。 |
| 效果确认（已发≠已生效） | 测试读取候选文档，并与生产源码角色集合及 git diff 精确对账。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节、字面量错误或角色集合不等 | 测试非零退出，阻断交付 | 是 | 无降级 |
| 候选范围超出唯一新增 Markdown | 范围 oracle 非零退出，阻断交付 | 是 | 无降级 |

### 输入对抗面

N/A — 本 Sprint 不新增对外 agent 或输入面。

## Golden Path

独立小路（无父路）

[阅读说明] → [选择创建或查询端点并正确鉴权] → [按九角色及 payload 契约构造请求] → [识别成功派发或完整失败回滚]

### Step 1：读者识别两个端点用途与鉴权边界

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1、2 项。

**可观测行为**: 文档分别说明 POST 创建并派发、GET 按 attempt id 查询；说明 `internalAuthOrLoopback`，并明确非回环（宿主/远端）必须使用 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，错误或缺失 token 不可访问。

**验证命令**: `npx vitest run sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.test.ts -t '端点用途与鉴权正向内容完整，且负向边界明确'`

**硬阈值**: 两个端点、三项鉴权字面量与正负鉴权语义全部命中；任一缺失即失败。

### Step 2：读者取得完整且封闭的九角色白名单

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项与生产权威白名单假设。

**可观测行为**: 文档先逐项完整列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，再说明合计九项；列表与生产 `ALLOWED_ROLES` 精确同集，不含别名或额外角色。

**验证命令**: `npx vitest run sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.test.ts -t '角色白名单先完整列名再计数，且与生产集合不多不少'`

**硬阈值**: 列表长度恰好 9，集合等于生产源码，重复项、缺项、多项或别名均失败。

### Step 3：读者区分 payload 必填项与唯一可省略项

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项。

**可观测行为**: 文档把 `sprint_dir`、`base_repo`、`branch` 明示为必填；把 `base_sha` 明示为可省略，并说明省略时由生产 Brain 自解析。不得暗示前三项可代填。

**验证命令**: `npx vitest run sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.test.ts -t 'payload 正确区分三个必填字段与 base_sha 可省略'`

**硬阈值**: 三个必填字段逐项命中，`base_sha` 可省略及生产 Brain 自解析均命中；反向误导短语为零。

### Step 4：读者识别派发失败的完整回滚终态

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5、6 项。

**可观测行为**: 文档在同一回滚章节完整列出 `run → failed`、`session → closed`、`task → cancelled`，并明确三者全部完成才是完整回滚，不能只看 run。

**验证命令**: `npx vitest run sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.test.ts -t '派发失败列全三组回滚终态且禁止部分成功解释'`

**硬阈值**: 三组映射全部逐字命中，并存在“全部”语义；任一缺失即失败。

### Step 5：候选变更严格限制为一页新增中文文档

**来源**: `[AI_ADDED]` — 将 PRD 范围限定转成防止旁路修改的冻结基线 oracle。

**可观测行为**: 从冻结 `BASE_SHA` 到候选 `HEAD` 的 diff 恰好只有一个 `A` 状态的 `docs/current/*.md`，且该文档含中文；无任何代码或其他文件变化。

**验证命令**: `BASE_SHA=e0a56e2efaa96a5e9b1759f6b1086282121454dd npx vitest run sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.test.ts -t '冻结基线范围只允许新增一页 docs/current 中文 Markdown'`

**硬阈值**: coding-contract canonical diff `git diff --name-status "$BASE_SHA"...HEAD -- . ":(exclude)$SPRINT_DIR/**"` 的解析结果长度等于 1，状态为 `A`，路径为目标文档；中文字符至少一个。冻结合同产物仅由排除 pathspec 隔离，不得改写基线。

## 真实调用方请求 shape

N/A — 本 Sprint 不创建调用方或修改请求协议；文档只复述生产端已存在的调用方式。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A）

## 接缝清单

无。本 Sprint 仅校验静态文档与生产源码的一致性，不宣称实际派发链路已重新执行。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例是否会让读者省略 `sprint_dir`、`base_repo` 或 `branch`。
- 重复提交: 检查文档是否把重复 POST 描述成天然幂等。
- 中途中断: 检查派发失败说明是否遗漏 session 或 task 的回滚终态。
- 边界值: 检查未知 role 与错误 Bearer token 是否被明确拒绝。
发现分级: P0/P1（鉴权泄漏或错误派发指导）阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web（仅作为仓库工作区验证环境；无 UI 变更）

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=e0a56e2efaa96a5e9b1759f6b1086282121454dd
export BASE_SHA
npx vitest run sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.test.ts --reporter=verbose
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 文档完整契约 | `sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.test.ts` | `端点用途与鉴权正向内容完整，且负向边界明确`；`角色白名单先完整列名再计数，且与生产集合不多不少`；`payload 正确区分三个必填字段与 base_sha 可省略`；`派发失败列全三组回滚终态且禁止部分成功解释`；`冻结基线范围只允许新增一页 docs/current 中文 Markdown` | 目标文档尚不存在，5 个测试均失败 |

## 断言两两推演

共 5 条正向 oracle 与 5 条对应负向 oracle：端点鉴权、角色集合、payload、回滚、范围各一对。逐对及两两交叉推演共 45 次（10 条断言任取两条），无互斥前提：内容断言共同读取同一目标文档；范围断言用 canonical 排除 pathspec 隔离冻结 Sprint 合同产物后，只约束实现阶段唯一新增文件；生产源码仅作只读权威来源。结论：断言无矛盾，且任何正向内容缺失或任一负向禁例出现都会失败。
