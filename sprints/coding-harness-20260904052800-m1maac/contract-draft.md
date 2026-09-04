# Sprint Contract Draft (Round 1)

## 技术与证据来源

- 权威实现基线：`84f46709f6cf797939f6ee55b6ef790f07d3e0ef`（全角色保持不变）。
- PRD 正文：bundle `thin_prd` 优先，`sprint-prd.md` 补充。
- 生产事实：`packages/brain/src/routes/harness-attempt-run.js` 的路由、鉴权、`ALLOWED_ROLES`、payload 校验与 rollback。
- Registry：API/DB/test registry 未提供可用条目，按 PRD 字面与生产源码，标记 `[NEW_PATTERN]`。
- Unified Map：`map_scope` 不是可用 scope 且 `map_repo` 缺失，标记 `[MAP_NOT_CONFIGURED]`；无 `must_run_assertions`、`fact_revisions` 或 freshness 可纳入。
- context-manifest：unavailable；累积 FR 以 PRD 的“暂无历史”为准。

## Response Schema（推导来源: N/A）

N/A — 本任务只新增说明文档，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → `ALLOWED_ROLES` 长度为 9，包含九个生产角色且排除 `commander`、`publisher`。
- `packages/brain/src/middleware/internal-auth.test.js` → loopback 与远端鉴权行为受 `internalAuthOrLoopback` 保护。
- [累积FR] 本 line 暂无历史；context-manifest: unavailable。
- [MAP_NOT_CONFIGURED] 本轮不回退到领域硬编码断言。

## 八要素需求规范

| 要素 | 本次答案 |
|------|----------|
| FR（做什么） | 新增一页中文说明，准确覆盖两个端点、鉴权、九项角色、payload 与失败回滚。 |
| NFR（做得多好） | 所有枚举先逐项列出再断言 exact-count；每个正向 oracle 配负向 oracle。 |
| Invariant（永不违反） | 不改代码；远端不得被描述为免鉴权；`base_sha` 不得列为必填。 |
| 判定点（怎么知道） | 以生产源码字面值和冻结 Vitest 断言判定。 |
| 保质期（何时过期） | 生产路由契约改变时文档同步更新；本合同不设时间失效值。 |
| 死亡告警（停了谁知道） | Sprint Tests 或范围 oracle 失败即阻塞合并。 |
| 失败语义（挂了怎么办） | 任一缺项、错项、额外枚举或越界文件均 fail-closed。 |
| 效果确认（已发≠已生效） | 从最终 Git diff 读取唯一文档并执行内容、负向与范围断言。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 文档缺项、错项或多项 | 测试非零退出并阻塞合并 | 是 | 无降级，修正文档 |
| 变更范围出现其他文件 | 范围 oracle 非零退出并阻塞合并 | 是 | 无降级，移除越界变更 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入面。

## Golden Path

独立小路（无父路）

[阅读说明] → [选择端点并正确鉴权] → [按角色与 payload 派发] → [查询成功或回滚终态]

### Step 1: 调用方识别创建与查询端点
**来源**: `[FROM_PRD]` — “Golden Path（核心场景）”第 1 项。

**可观测行为**: 文档说明 POST 用于创建并派发，GET 用于按 id 查询，错误复数路径不被接受。

**验证命令**: `npx vitest run sprints/coding-harness-20260904052800-m1maac/tests/attempt-run-bridge-guide.test.ts -t '中文文档包含两个端点用途，且错误端点不能通过'`

**硬阈值**: 两个正确端点与用途全部出现，错误端点出现次数为 0；以上命令 exit 0。

### Step 2: 调用方按来源执行鉴权
**来源**: `[FROM_PRD]` — “Golden Path（核心场景）”第 2 项及“边界情况”。

**可观测行为**: 文档明确 `internalAuthOrLoopback`，并明确宿主/远端携带 `Bearer CECELIA_INTERNAL_TOKEN`，不得宣称远端免鉴权。

**验证命令**: `npx vitest run sprints/coding-harness-20260904052800-m1maac/tests/attempt-run-bridge-guide.test.ts -t '鉴权区分 loopback 与宿主远端，且远端免鉴权不能通过'`

**硬阈值**: 正向三项全部出现且远端免鉴权表述为 0；以上命令 exit 0。

### Step 3: 调用方选择合法角色
**来源**: `[FROM_PRD]` — “Golden Path（核心场景）”第 3 项。

**可观测行为**: 文档逐项列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，然后断言恰好 9 项；额外角色不能通过。

**验证命令**: `npx vitest run sprints/coding-harness-20260904052800-m1maac/tests/attempt-run-bridge-guide.test.ts -t '角色白名单逐项列出且恰好九项，增删角色不能通过'`

**硬阈值**: 上述九项按生产顺序完全相等、长度等于 9、`commander` 不存在；以上命令 exit 0。

### Step 4: 调用方构造 payload
**来源**: `[FROM_PRD]` — “Golden Path（核心场景）”第 4 项。

**可观测行为**: 必填字段先逐项列出 `sprint_dir`、`base_repo`、`branch`，再断言恰好 3 项；`base_sha` 仅列为可省略且由生产 Brain 自解析。

**验证命令**: `npx vitest run sprints/coding-harness-20260904052800-m1maac/tests/attempt-run-bridge-guide.test.ts -t 'payload 必填项逐项列出且恰好三项，base_sha 列为可省略'`

**硬阈值**: 必填集合完全等于三项、长度等于 3、反向排除 `base_sha`；以上命令 exit 0。

### Step 5: 调用方识别派发失败终态
**来源**: `[FROM_PRD]` — “Golden Path（核心场景）”第 5 项。

**可观测行为**: 文档逐项列出 `run→failed`、`session→closed`、`task→cancelled`，再断言恰好 3 项；错误终态不能通过。

**验证命令**: `npx vitest run sprints/coding-harness-20260904052800-m1maac/tests/attempt-run-bridge-guide.test.ts -t '派发失败回滚逐项列出且恰好三个终态，缺项或错态不能通过'`

**硬阈值**: 三项完全相等、长度等于 3、`task→completed` 不存在；以上命令 exit 0。

### Step 6: 仅交付约定文档
**来源**: `[AI_ADDED]` — 将 PRD“不改任何代码”转为不可被 sprint 合同文件干扰的范围防伪 oracle。

**可观测行为**: 过滤 `sprints/` 后，相对实现基线的变更恰好只有交付文档。

**验证命令**:
```bash
BASE_SHA=84f46709f6cf797939f6ee55b6ef790f07d3e0ef
allowed='docs/current/attempt-run-bridge-guide.md'
actual=$(git diff --name-only "$BASE_SHA"...HEAD | grep -v '^sprints/' | sort)
expected=$(printf '%s\n' "$allowed" | sort)
test "$actual" = "$expected"
```

**硬阈值**: `actual` 与单项 `allowed` 字节相等；命令 exit 0，任何代码文件或第二个非 sprint 文件均失败。

## 断言两两推演

- 正向断言总数：18；负向断言总数：5；范围 exact-set 断言：1。总计 24 个机器断言。
- 角色 presence 九项与 exact-count=9 交叉检查：presence 防替换，exact-count 防增项，二者相容。
- payload presence 三项与 exact-count=3、`base_sha` negative 交叉检查：前三项位于“必填字段”小节，`base_sha` 位于可选说明，互不冲突。
- 回滚 presence 三项与 exact-count=3、错态 negative 交叉检查：三项逐字相等，互不冲突。
- 端点、鉴权正向 oracle 分别配错误端点、远端免鉴权负向 oracle；范围正向 exact-set 同时排除所有额外文件。
- 两两推演结论：全部 exact-count、presence、negative 与范围断言无互斥。

## 真实调用方请求 shape

N/A — 本 Sprint 不修改或发送生产请求，只说明既有调用契约。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期或 DB 写路径，N/A）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

gp-anchor: skipped (product-map.json not found)

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误把未知 role 写成可派发。
- 重复提交: 检查同一枚举是否重复列出却利用数量措辞掩盖。
- 中途中断: N/A，静态文档无运行中状态。
- 边界值: 检查必填字段 0 项、4 项以及角色 8 项、10 项时均失败。
发现分级: P0/P1（错误鉴权或错误生产契约）阻塞 merge；P2/P3 记 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=84f46709f6cf797939f6ee55b6ef790f07d3e0ef
DOC=docs/current/attempt-run-bridge-guide.md
npx vitest run sprints/coding-harness-20260904052800-m1maac/tests/attempt-run-bridge-guide.test.ts --reporter=verbose
node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8"); if(!/[\u3400-\u9fff]/u.test(s)) process.exit(1)' "$DOC"
allowed='docs/current/attempt-run-bridge-guide.md'
actual=$(git diff --name-only "$BASE_SHA"...HEAD | grep -v '^sprints/' | sort)
expected=$(printf '%s\n' "$allowed" | sort)
test "$actual" = "$expected"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 端点用途 | `sprints/coding-harness-20260904052800-m1maac/tests/attempt-run-bridge-guide.test.ts` | `中文文档包含两个端点用途，且错误端点不能通过` | 文档未实现时 `ENOENT`，测试失败 |
| 鉴权 | `sprints/coding-harness-20260904052800-m1maac/tests/attempt-run-bridge-guide.test.ts` | `鉴权区分 loopback 与宿主远端，且远端免鉴权不能通过` | 文档未实现时 `ENOENT`，测试失败 |
| 九项角色 | `sprints/coding-harness-20260904052800-m1maac/tests/attempt-run-bridge-guide.test.ts` | `角色白名单逐项列出且恰好九项，增删角色不能通过` | 文档未实现时 `ENOENT`，测试失败 |
| payload | `sprints/coding-harness-20260904052800-m1maac/tests/attempt-run-bridge-guide.test.ts` | `payload 必填项逐项列出且恰好三项，base_sha 列为可省略` | 文档未实现时 `ENOENT`，测试失败 |
| 回滚 | `sprints/coding-harness-20260904052800-m1maac/tests/attempt-run-bridge-guide.test.ts` | `派发失败回滚逐项列出且恰好三个终态，缺项或错态不能通过` | 文档未实现时 `ENOENT`，测试失败 |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)。
- 本合同不要求改动 Brain 源码，因此不触发 Brain 代码版本升级。
