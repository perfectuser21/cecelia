# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A）

N/A — 本 Sprint 仅新增既有 API 的中文说明，不新增或修改 HTTP 响应。

## 已知约束

- [packages/brain/src/routes/harness-attempt-run.js] → 两端点均使用 `internalAuthOrLoopback`，生产 Bearer 环境变量为 `CECELIA_INTERNAL_TOKEN`。
- [packages/brain/src/routes/harness-attempt-run.js] → POST 用于异步派发，GET 用于轮询结构化 attempt 结果。
- [sprint-prd.md/累积 FR] → 本 line 暂无历史；context-manifest 因 `journey_id=none` 不适用。
- [MAP_NOT_CONFIGURED] task payload 未配置 map_scope/map_repo，无 must_run_assertions。

gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/` 新增中文说明，覆盖端点用途、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 名称逐字准确；不得出现真实 token；实现 diff 仅一份说明文档。 |
| Invariant（永不违反） | 不改代码、配置、API 或 DB；不硬编码凭据；远端鉴权不得描述为可省略。 |
| 判定点（怎么知道） | 由冻结 Vitest 与独立 shell oracle 检查文档结构和字面值。 |
| 保质期（何时过期） | 接口合同变化时由 Brain 接口维护者同步更新本页。 |
| 死亡告警（停了谁知道） | Sprint Tests/合同回归失败即由 CI 向 PR 作者报告。 |
| 失败语义（挂了怎么办） | 任一必备章节、闭集成员或唯一文件约束不符即阻塞合并。 |
| 效果确认（已发≠已生效） | 从实现基线读取 Git diff，并实际解析交付文档内容。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺字段或角色 | 测试非零退出并阻塞合并 | 是 | 无降级 |
| 实现 diff 出现额外文件 | 测试非零退出并阻塞合并 | 是 | 无降级 |

### 输入对抗面

N/A — 本 Sprint 不新增对外 agent 或输入入口。

## 真实调用方请求 shape

N/A — 本 Sprint 只描述既有端点，不发送业务请求；鉴权字面合同依据生产中间件为 `Authorization: Bearer CECELIA_INTERNAL_TOKEN`。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期或 DB 写路径，N/A）

## Golden Path

独立小路（无父路）

[读者打开说明] → [确认端点与鉴权] → [按九角色和 payload 派发] → [查询状态并理解失败回滚]

### Step 1: 找到中文说明并识别两个端点用途
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1、6 项。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 为中文，POST 被说明为派发入口，GET 被说明为状态查询入口。

**验证命令**: `node -e "const fs=require('fs'),p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!/[\u4e00-\u9fff]/.test(s)||!s.includes('POST /api/brain/harness/attempt-run')||!s.includes('GET /api/brain/harness/attempt-run/:id')||!/派发/.test(s)||!/(查询|轮询)/.test(s))process.exit(1)"`

**硬阈值**: 文件存在；中文字符至少 1 个；两个端点及其不同用途全部命中。以上命令 exit 0。

### Step 2: 采用正确的内部鉴权
**来源**: `[FROM_PRD]` — thin PRD 验收项 1 与 PRD「边界情况」。

**可观测行为**: 文档明确两个端点使用 `internalAuthOrLoopback`，宿主或远端必须发送 `Authorization: Bearer CECELIA_INTERNAL_TOKEN`，且不含真实密钥值。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(!s.includes('internalAuthOrLoopback')||!s.includes('Bearer CECELIA_INTERNAL_TOKEN')||!/(宿主|远端)/.test(s))process.exit(1)"`

**硬阈值**: 三项鉴权字面值全部命中；命令 exit 0。

### Step 3: 选择九角色并构造 payload
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3、4 项。

**可观测行为**: 独立「角色白名单」节恰好逐行列出 `planner`、`proposer`、`skeptic`、`generator`、`generator-fix`、`evaluator`、`judge`、`reporter`、`controller`；独立「Payload 字段」节将 `sprint_dir`、`base_repo`、`branch` 标为必填，将 `base_sha` 标为可省略并由生产 Brain 自解析。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts`

**硬阈值**: 角色数组与九项闭集按顺序全等；三个必填字段和一个可选字段全部通过；Vitest exit 0。

### Step 4: 查询 attempt 并识别派发失败回滚
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 项。

**可观测行为**: 文档说明提交返回的 id 用于 GET 查询，并明确派发失败自动回滚为 run → `failed`、session → `closed`、task → `cancelled`。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const r of [/run\\s*(?:→|->)\\s*\`?failed\`?/,/session\\s*(?:→|->)\\s*\`?closed\`?/,/task\\s*(?:→|->)\\s*\`?cancelled\`?/])if(!r.test(s))process.exit(1)"`

**硬阈值**: 三个对象及终态全部命中；命令 exit 0。

### Step 5: 封印实现坐标与唯一交付
**来源**: `[AI_ADDED]` — 防止使用 workspace checkout SHA 或 PRD 中陈旧 SHA 替换权威实现基线，并防止文档任务夹带代码。

**可观测行为**: 实现验收始终相对 `inputs.implementation_baseline.base_sha=109d1df64cdc68fbec8852c3ad2d0e3291e648ef`；排除冻结合同目录后，变更闭集仅为 `docs/current/attempt-run-bridge-guide.md`。

**验证命令**: `bash -c 'EXTRA=$(git diff --name-only 109d1df64cdc68fbec8852c3ad2d0e3291e648ef...HEAD -- . ":(exclude)sprints/coding-harness-20260901070958-avqlef" | grep -Fvx "docs/current/attempt-run-bridge-guide.md" || true); test -z "$EXTRA"; git diff --name-only 109d1df64cdc68fbec8852c3ad2d0e3291e648ef...HEAD -- docs/current/attempt-run-bridge-guide.md | grep -Fx "docs/current/attempt-run-bridge-guide.md"'`

**硬阈值**: 实现基线保持上述 SHA；产品交付 diff 恰好一项；命令 exit 0。

## 接缝清单

（本单只新增静态文档，无真实世界接缝，N/A）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例是否会把 `base_sha` 误列为必填。
- 重复提交: N/A，静态文档无提交入口。
- 中途中断: N/A，静态文档无运行态。
- 边界值: 检查角色白名单是否出现第十项、别名或漏项。
发现分级: P0/P1（凭据泄露或会误导远端鉴权）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web（本 Sprint 无 UI；按 PRD 路由在宿主工作区执行文档验收）

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR='sprints/coding-harness-20260901070958-avqlef'
BASE_SHA='109d1df64cdc68fbec8852c3ad2d0e3291e648ef'
GUIDE='docs/current/attempt-run-bridge-guide.md'
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts"
test -f "$GUIDE"
EXTRA=$(git diff --name-only "$BASE_SHA"...HEAD -- . ":(exclude)$SPRINT_DIR" | grep -Fvx "$GUIDE" || true)
test -z "$EXTRA"
git diff --name-only "$BASE_SHA"...HEAD -- "$GUIDE" | grep -Fx "$GUIDE"
echo 'Golden Path 文档验收通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts` | `文档为中文并说明 POST 派发与 GET 状态查询用途`；`文档说明 internalAuthOrLoopback 与远端 Bearer CECELIA_INTERNAL_TOKEN`；`文档角色白名单恰好列出九个 PRD 角色`；`文档区分三个 payload 必填字段与可省略的 base_sha`；`文档说明派发失败的 run session task 完整回滚终态` | 实现前因说明文档不存在产生 5 个 failures |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- 权威实现基线固定为 `109d1df64cdc68fbec8852c3ad2d0e3291e648ef`；不得使用 workspace checkout SHA 或 PRD A6 的陈旧 SHA 替换。
- 文档角色闭集遵循冻结 PRD；当前源码 `ALLOWED_ROLES` 与其不一致属于既有事实差异，本 Sprint 范围禁止改代码。
