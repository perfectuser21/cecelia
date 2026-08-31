# Sprint Contract Draft (Round 1)

## 范围与基线

- 实现基线：`perfectuser21/cecelia@f06b922d05c1105783b66c22b5912d3430dc2d44`（后续角色不得用 checkout SHA 替换）。
- 仅新增 `docs/current/attempt-run-bridge-guide.md`，不修改任何代码。
- `[MAP_NOT_CONFIGURED]`：task bundle 未提供 `map_scope/map_repo`，无 `must_run_assertions`；Unified Map 不回退到硬编码领域地图。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: N/A）

N/A — 本任务只新增说明文档，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 角色白名单封闭且正好九项；路由包含 `/attempt-run` 与 `/attempt-run/:attemptId`。
- `packages/brain/src/middleware/internal-auth.test.js` → `internalAuthOrLoopback` 在 token 已配置时严格鉴权；未配置时仅非生产 loopback 放行。
- `[累积FR] context-manifest: unavailable`（task bundle 未提供 journey_id，无法形成合法查询）。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增中文说明页，覆盖两个端点用途、鉴权、九项角色、payload 字段和派发失败回滚。 |
| NFR（做得多好） | 单页可检索；端点、角色及字段均使用生产源码中的字面名称。 |
| Invariant（永不违反） | 只改文档；不得把远端/宿主调用描述成免鉴权；不得把 `base_sha` 写成必填。 |
| 判定点（怎么知道） | 由冻结 Vitest 与 E2E 内容断言判定四节是否完整。 |
| 保质期（何时过期） | 路由、鉴权、白名单、payload 或回滚语义改变时，由对应代码变更维护者同步更新。 |
| 死亡告警（停了谁知道） | Sprint Tests 在文档缺失或关键字漂移时阻断 CI，由 PR 作者获知。 |
| 失败语义（挂了怎么办） | 任一必备内容缺失即测试非零退出并阻断合并，不降级放行。 |
| 效果确认（已发≠已生效） | 对 HEAD 中真实文档逐项读取并验证中文和全部字面契约。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或任一契约项缺失 | Vitest/E2E 退出非零并阻断合并 | 是，补齐文档后可重复验证 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入入口。

## Golden Path

独立小路（无父路）

[读者打开说明页] → [了解端点与鉴权] → [按白名单和 payload 构造请求] → [理解失败回滚结果]

### Step 1: 读者定位两个桥接端点及鉴权方式

**来源**: `[FROM_PRD]` — thin_prd 第 1 项。

**可观测行为**: 文档中文说明 `POST /api/brain/harness/attempt-run` 用于异步派发并返回 202/attempt 标识，`GET /api/brain/harness/attempt-run/:id` 用于轮询结构化结果；明确二者使用 `internalAuthOrLoopback`，宿主或远端必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。

**验证命令**:
```bash
node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');for(const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','internalAuthOrLoopback','Bearer','CECELIA_INTERNAL_TOKEN'])if(!s.includes(x))throw new Error('缺少 '+x)"
```

**硬阈值**: 两个端点、鉴权中间件、Bearer 与 token 变量五项全部命中；验证命令 exit 0。

### Step 2: 读者取得封闭的九项角色白名单

**来源**: `[FROM_PRD]` — thin_prd 第 2 项；九项字面值由生产 `ALLOWED_ROLES` 核实。

**可观测行为**: 文档逐项列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，并说明白名单外角色会被拒绝。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');const roles=['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge'];for(const r of roles)if(!s.includes('\`'+r+'\`'))throw new Error('缺少角色 '+r);if(roles.length!==9)process.exit(1)"
```

**硬阈值**: 九项角色逐字出现且数量基准为 9；验证命令 exit 0。

### Step 3: 读者识别 payload 必填项与 base_sha 默认行为

**来源**: `[FROM_PRD]` — thin_prd 第 3 项。

**可观测行为**: 文档将 `sprint_dir`、`base_repo`、`branch` 标为 payload 必填字段，并明确 `base_sha` 可省略、由生产 Brain 自行解析；不得把 `base_sha` 表述为必填。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['sprint_dir','base_repo','branch','base_sha','可省略','生产 Brain'])if(!s.includes(x))throw new Error('缺少 '+x);if(/base_sha[^\n]{0,20}(必须|必填)/.test(s))throw new Error('base_sha 被误写为必填')"
```

**硬阈值**: 三个必填字段与 `base_sha` 可省略语义全部命中，且无 `base_sha` 必填误导；验证命令 exit 0。

### Step 4: 读者理解派发失败的原子回滚

**来源**: `[FROM_PRD]` — thin_prd 第 4 项。

**可观测行为**: 文档明确仅当本次创建的桥接资源派发抛错或未返回 `LAUNCHED` 时，自动执行 `run → failed`、`session → closed`、`task → cancelled`，避免孤儿活跃资源。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['run → failed','session → closed','task → cancelled','LAUNCHED'])if(!s.includes(x))throw new Error('缺少回滚语义 '+x)"
```

**硬阈值**: 三个资源终态及触发条件全部命中；验证命令 exit 0。

## 真实调用方请求 shape

本 Sprint 不改 API；文档示例必须保持现有调用 shape：`Authorization: Bearer $CECELIA_INTERNAL_TOKEN` header、`Content-Type: application/json`，请求 body 顶层包含 `role`、`title`、`payload`，其中 payload 使用 `sprint_dir/base_repo/branch`。不得另造 body token。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本单只冻结说明文档内容，无真实世界接缝，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 对照源码检查文档是否错误地允许白名单外 role。
- 重复提交: N/A，说明页无提交动作。
- 中途中断: N/A，说明页无异步状态。
- 边界值: 检查 `base_sha` 省略语义与三项 payload 必填字段没有互相矛盾。
发现分级: P0/P1（鉴权或回滚说明会导致安全/资源泄漏）阻塞 merge；P2/P3 记 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
DOC='docs/current/attempt-run-bridge-guide.md'
node - "$DOC" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const text = fs.readFileSync(path, 'utf8');
if (!/[\u4e00-\u9fff]/.test(text)) throw new Error('文档必须包含中文');
const sections = ['端点用途与鉴权', '角色白名单', 'payload 字段', '派发失败自动回滚'];
for (const section of sections) if (!text.includes(section)) throw new Error(`缺少章节 ${section}`);
const literals = [
  'POST /api/brain/harness/attempt-run', 'GET /api/brain/harness/attempt-run/:id',
  'internalAuthOrLoopback', 'Bearer', 'CECELIA_INTERNAL_TOKEN',
  'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
  'evaluator', 'evaluator-evidence-repair', 'judge',
  'sprint_dir', 'base_repo', 'branch', 'base_sha', '可省略', '生产 Brain',
  'run → failed', 'session → closed', 'task → cancelled', 'LAUNCHED',
];
for (const literal of literals) if (!text.includes(literal)) throw new Error(`缺少 ${literal}`);
if (/base_sha[^\n]{0,20}(必须|必填)/.test(text)) throw new Error('base_sha 不得写成必填');
NODE
git diff --name-only f06b922d05c1105783b66c22b5912d3430dc2d44...HEAD | awk 'BEGIN{ok=1} $0 !~ /^docs\/current\/attempt-run-bridge-guide\.md$/ && $0 !~ /^sprints\/coding-harness-20260831042346-jlgxtw\// {print "越界文件: "$0;ok=0} END{exit !ok}'
```

通过标准：脚本 exit 0；文档含中文、四个指定章节和全部字面契约，且实现阶段除目标文档与冻结 Sprint 产物外不改其他文件。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明完整性 | `sprints/coding-harness-20260831042346-jlgxtw/tests/attempt-run-bridge-guide.test.ts` | `说明两个端点用途与远端 Bearer 鉴权`；`逐项列出九个允许角色`；`区分三个 payload 必填字段与可省略 base_sha`；`说明派发失败的三个资源回滚终态` | 目标文档尚不存在，4 个测试均因 `ENOENT` 失败 |

