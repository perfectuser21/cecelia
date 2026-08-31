# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面）

N/A — 任务不新增或修改 HTTP 响应；仅说明既有端点。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 角色白名单封闭：包含九个执行角色，永不包含 commander/publisher。
- `[累积FR] context-manifest: unavailable`。
- Unified Map：`[MAP_NOT_CONFIGURED]`，无 `must_run_assertions` 注入。

## 八要素需求规范

| 要素 | 本次答案 |
|------|----------|
| FR（做什么） | 新增中文 attempt-run 桥接使用说明，覆盖两个端点、鉴权、九项角色、payload 和失败回滚。 |
| NFR（做得多好） | 内容可由冻结 Vitest 逐节解析，且与生产源码字面一致。 |
| Invariant（永不违反） | 只改文档；不泄露 token；不把远端匿名访问描述为可用。 |
| 判定点（怎么知道） | 以生产路由与鉴权中间件源码为事实源，以冻结测试解析文档。 |
| 保质期（何时过期） | 端点、角色或鉴权契约变化时由对应代码变更维护者同步更新。 |
| 死亡告警（停了谁知道） | Sprint Tests 在文档缺失或关键契约漂移时立即失败，由 PR 作者获知。 |
| 失败语义（挂了怎么办） | 缺节、字段错误或角色不全一律阻塞合并，不降级放行。 |
| 效果确认（已发≠已生效） | 从提交树读取文档，并逐项断言四节内容。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 文档缺失或内容不完整 | 测试非零退出并阻塞合并 | 是 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入面。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## 真实调用方请求 shape

本 Sprint 仅说明既有桥接接口，不改变调用 shape。文档示例必须使用 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`；POST body 必须以 `payload.sprint_dir`、`payload.base_repo`、`payload.branch` 为必填坐标，并说明 `payload.base_sha` 可省略。

## 禁 mock 边清单

（本单纯文档改动，无调度、状态机、跨模块、生命周期或 DB 写路径变更，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## Golden Path

独立小路（无父路）

[读者打开文档] → [识别端点与鉴权] → [选择合法角色并填写 payload] → [理解失败回滚]

### Step 1: 读者识别两个桥接端点及鉴权
**来源**: `[FROM_PRD]` — PRD“文档必须覆盖”第 1 项。

**可观测行为**: 文档分别解释 POST 异步派发与 GET 按 attempt id 轮询结果，并明确远端必须携带 Bearer token。

**验证命令**: `node -e` 读取目标文档并断言两个路径、`internalAuthOrLoopback`、`Bearer` 和 `CECELIA_INTERNAL_TOKEN`。

**硬阈值**: 上述五项全部出现；任一缺失退出非 0。

### Step 2: 读者取得完整角色白名单
**来源**: `[FROM_PRD]` — PRD“文档必须覆盖”第 2 项。

**可观测行为**: 文档列出 canary、planner、proposer、reviewer、generator、generator-fix、evaluator、evaluator-evidence-repair、judge 九项且无 commander/publisher。

**验证命令**: 冻结 Vitest 对九项角色逐一断言，并断言禁用角色不在白名单段。

**硬阈值**: 恰好覆盖生产 `ALLOWED_ROLES` 的九个值。

### Step 3: 读者按契约构造 payload
**来源**: `[FROM_PRD]` — PRD“文档必须覆盖”第 3 项。

**可观测行为**: 文档明确 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略并由生产 Brain 自解析。

**验证命令**: 冻结 Vitest 读取 payload 小节并逐字段断言。

**硬阈值**: 三个必填字段与一个可省略字段语义全部存在。

### Step 4: 读者理解派发失败后的原子回滚
**来源**: `[FROM_PRD]` — PRD“文档必须覆盖”第 4 项。

**可观测行为**: 文档明确 run → failed、session → closed、task → cancelled，避免误判为仍在运行。

**验证命令**: 冻结 Vitest 读取回滚小节并断言三个状态映射。

**硬阈值**: 三个资源状态映射全部字面匹配。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
DOC="docs/current/attempt-run-bridge-guide.md"
test -f "$DOC"
node - "$DOC" <<'NODE'
const fs = require('node:fs');
const text = fs.readFileSync(process.argv[2], 'utf8');
const required = [
  'POST /api/brain/harness/attempt-run',
  'GET /api/brain/harness/attempt-run/:id',
  'internalAuthOrLoopback',
  'Bearer CECELIA_INTERNAL_TOKEN',
  'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
  'evaluator', 'evaluator-evidence-repair', 'judge',
  'sprint_dir', 'base_repo', 'branch', 'base_sha',
  'run → failed', 'session → closed', 'task → cancelled',
];
for (const item of required) {
  if (!text.includes(item)) throw new Error(`文档缺少：${item}`);
}
if (!/base_sha[^\n]*(可省略|无需提供)/.test(text)) throw new Error('base_sha 可省略语义缺失');
if (!/[\u4e00-\u9fff]/.test(text)) throw new Error('文档不是中文');
NODE
git diff --name-only 88929fa377f5bed3cd1876a575c366ff1b93c0d5...HEAD -- packages/brain/src | test "$(wc -l)" -eq 0
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误称 `base_sha` 必填。
- 重复提交: 检查九项角色是否因相似名称重复或漏项。
- 中途中断: N/A，静态文档无运行中状态。
- 边界值: 检查远端、宿主、loopback 三种来源的鉴权表述是否歧义。
发现分级: P0/P1（泄露凭据或指导匿名远端访问）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260831163508-4cvw64/tests/attempt-run-bridge-guide.test.ts` | `说明两个端点与鉴权方式`、`列出完整九项角色白名单`、`说明 payload 必填字段与 base_sha 省略规则`、`说明派发失败的三资源回滚状态` | 目标文档尚不存在，4 个测试均失败 |

## Notes

- contract-gate: 使用 `packages/brain/src/lib/contract-gate.js` 进行后续机械审查。
- 本合同只允许新增 `docs/current/attempt-run-bridge-guide.md`；Sprint 合同与冻结测试除外，不允许修改生产代码。
