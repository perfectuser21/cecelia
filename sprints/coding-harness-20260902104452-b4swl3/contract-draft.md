# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A）

N/A — 本任务仅新增说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → attempt-run 路由包含创建与查询路径。
- [packages/brain/src/middleware/internal-auth.test.js] → `internalAuthOrLoopback` 区分 loopback 与远端 Bearer 鉴权。
- [累积FR] 本 line 暂无历史。
- Unified Map: `[MAP_NOT_CONFIGURED]`（任务 payload 的 `map_scope` 为空，未回退到领域硬编码）。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-bridge-guide.md` 新增中文说明，覆盖端点、鉴权、九项角色、payload 与失败回滚。 |
| NFR（做得多好） | 四个独立章节；关键字可机械匹配；不得泄露真实 token。 |
| Invariant（永不违反） | 不改代码；不写真实凭据；不把非白名单角色描述为可派发。 |
| 判定点（怎么知道） | 由冻结测试逐字核对文档，并以 canonical 全仓 diff 核对范围。 |
| 保质期（何时过期） | 当 attempt-run 接口契约变化时由接口维护者同步修订文档。 |
| 死亡告警（停了谁知道） | Sprint Tests 在文档缺失、内容漂移或越界改动时立即失败并通知 PR 作者。 |
| 失败语义（挂了怎么办） | 任一内容或范围断言失败即阻塞交付，不降级放行。 |
| 效果确认（已发≠已生效） | 从 Git 候选树读取真实文档，并逐字验证四节与 canonical diff。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺项或用词错误 | 测试非零退出并阻塞交付 | 是 | 无 |
| 候选树出现越界实现文件 | canonical diff 测试非零退出并阻塞交付 | 是 | 无 |

### 输入对抗面

N/A — 本任务不新增对外 Agent 或输入入口。

## Golden Path

独立小路（无父路）

[阅读说明] → [确认端点与鉴权] → [按白名单及 payload 创建运行] → [查询状态并理解失败回滚]

### Step 1: 识别创建与查询端点
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 项。

**可观测行为**: 文档分别说明 POST 创建并派发、GET 按 id 查询状态。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t '说明创建与查询端点用途'`

**硬阈值**: 两个端点及各自用途均逐字出现；上述命令 exit 0。

### Step 2: 使用正确鉴权
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 2 项。

**可观测行为**: 读者知道两个端点由 `internalAuthOrLoopback` 保护，宿主或远端必须发送 Bearer token，且示例不包含真实 token。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t '说明鉴权且不泄露凭据'`

**硬阈值**: 鉴权名、Authorization 形式与占位符均存在，未出现疑似真实 token；上述命令 exit 0。

### Step 3: 按封闭角色与 payload 创建运行
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 3、4 项。

**可观测行为**: 文档仅列权威路由契约 `ALLOWED_ROLES` 的九项角色，并明确 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略且由生产 Brain 自解析。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t '角色白名单是封闭九项|说明 payload 必填与可省略字段'`

**硬阈值**: 角色集合精确等于生产路由的 `ALLOWED_ROLES` 九项（按 PRD ASSUMPTION 的权威契约优先规则），字段语义完整；上述命令 exit 0。

### Step 4: 查询并识别派发失败终态
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 5 项。

**可观测行为**: 文档说明派发失败自动回滚为 `run → failed`、`session → closed`、`task → cancelled`，并可经查询端点观察。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t '说明派发失败自动回滚'`

**硬阈值**: 三项状态映射与可查询性全部出现；上述命令 exit 0。

### Step 5: 限定交付范围
**来源**: `[AI_ADDED]` — 将 PRD「不改任何代码」转成 canonical 全仓 diff oracle，防止只检查目标文件而漏掉越界改动。

**可观测行为**: 相对冻结实现基线，排除 Sprint 合同控制产物后仅新增指定说明页。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t 'canonical 全仓 diff 仅包含目标文档'`

**硬阈值**: `git diff --name-only 48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3...HEAD -- .` 的实现范围精确等于 `docs/current/attempt-run-bridge-guide.md`；上述命令 exit 0。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 接缝清单

（本单只验证仓库内文档内容与 Git 差异，无真实世界接缝，N/A。）

## 真实调用方请求 shape

N/A — 本任务只记录既有接口，不新增或修改调用方请求。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

gp-anchor: skipped (product-map.json not found)

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否错误暗示匿名远端请求可访问。
- 重复提交: 检查九项角色或 payload 字段是否重复导致歧义。
- 中途中断: N/A，静态文档无执行中状态。
- 边界值: 检查 `base_sha` 省略语义是否被误写成必填。
发现分级: P0/P1（泄露凭据或错误鉴权说明）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web（仓库工作区内执行静态文档验收）

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3
SPRINT_DIR=sprints/coding-harness-20260902104452-b4swl3
DOC=docs/current/attempt-run-bridge-guide.md
test -f "$DOC"
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts"
mapfile -t IMPLEMENTATION_FILES < <(git diff --name-only "$BASE_SHA...HEAD" -- . | grep -v "^$SPRINT_DIR/" || true)
[ "${#IMPLEMENTATION_FILES[@]}" -eq 1 ]
[ "${IMPLEMENTATION_FILES[0]}" = "$DOC" ]
```

## Test Contract

冻结实现基线 SHA：`48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3`。本表及其 canonical 全仓 diff oracle 始终以该 SHA 为基线，不得替换为角色 checkout 的其他 SHA。

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 说明页完整性与封闭枚举 | `sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts` | `说明创建与查询端点用途`、`说明鉴权且不泄露凭据`、`角色白名单是封闭九项`、`说明 payload 必填与可省略字段`、`说明派发失败自动回滚` | 目标文档尚不存在，读取文件失败并产生 ≥1 failure |
| canonical 全仓范围 | `sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts` | `canonical 全仓 diff 仅包含目标文档` | 目标文档尚未进入 diff，精确集合断言失败 |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- 角色枚举按 PRD ASSUMPTION 核验 `packages/brain/src/routes/harness-attempt-run.js`：权威九项为 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`；因此未采用 thin PRD 中已漂移的旧角色拼写。
- 本合同不固定任何未来执行角色的 attempt 或 capability snapshot；验证身份保持 Runner late-bound。
