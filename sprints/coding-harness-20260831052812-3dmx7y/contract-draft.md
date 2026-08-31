# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面）

N/A — 本任务仅新增说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → 角色白名单封闭且恰含九个执行角色。
- [packages/brain/src/middleware/internal-auth.test.js] → `internalAuthOrLoopback` 对鉴权配置与 loopback 来源执行 fail-closed 校验。
- [累积FR] context-manifest: unavailable（本次 bundle 未提供 journey_id）。
- Unified Map: `[MAP_NOT_CONFIGURED]`（task bundle 未提供 map_scope/map_repo）；must_run_assertions 为空。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/` 新增一页中文 attempt-run 桥接使用说明，覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 四个主题均有独立章节；端点、字段、角色和状态值与生产源码逐字一致。 |
| Invariant（永不违反） | 只改文档；不泄露 token；不把远端调用描述成免鉴权。 |
| 判定点（怎么知道） | 由冻结 Vitest 对文档正文执行精确结构和词项断言。 |
| 保质期（何时过期） | 路由、白名单、payload 或回滚语义变化时由对应代码变更同步更新。 |
| 死亡告警（停了谁知道） | 文档契约测试在 Sprint Tests 失败并阻塞合并。 |
| 失败语义（挂了怎么办） | 缺任一章节、角色、字段或状态映射均 fail-closed；不接受部分通过。 |
| 效果确认（已发≠已生效） | 测试从仓库真实路径读取文档并验证中文及四类内容。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺页或缺主题 | 测试非零退出并阻塞合并 | 是 | 不降级 |
| 源码与文档词项不一致 | 测试非零退出并要求同步修正文档 | 是 | 不以近义词代替协议字面值 |

### 输入对抗面

N/A — 不新增对外 agent 或可写接口。

gp-anchor: skipped (product-map.json not found)

## 真实调用方请求 shape

本单不修改调用协议。文档必须说明生产调用方使用 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`；POST JSON body 顶层含 `role`、`title`，`payload` 内含 `sprint_dir`、`base_repo`、`branch`，`base_sha` 可省略。

## 禁 mock 边清单

（本单纯文档改动，无调度、状态机、跨模块、生命周期或 DB 写路径实现变更，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## Golden Path

独立小路（无父路）

[读者打开文档] → [确认端点与鉴权] → [选择合法角色并组装 payload] → [理解派发失败回滚]

### Step 1: 找到两个 attempt-run 端点及用途
**来源**: `[FROM_PRD]` — thin_prd 第 1 项。

**可观测行为**: 文档分别说明 POST 用于异步派发单角色 attempt，GET 用于按 attempt id 轮询结构化结果。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge.md','utf8');for(const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id'])if(!s.includes(x))process.exit(1)"`

**硬阈值**: 两个完整端点各出现至少一次；以上命令 exit 0。

### Step 2: 正确配置鉴权
**来源**: `[FROM_PRD]` — thin_prd 第 1 项。

**可观测行为**: 读者能区分 loopback 与宿主/远端调用，并知道远端必须携带 Bearer token。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge.md','utf8');for(const x of ['internalAuthOrLoopback','Authorization: Bearer','CECELIA_INTERNAL_TOKEN'])if(!s.includes(x))process.exit(1)"`

**硬阈值**: 三个鉴权关键字齐全；以上命令 exit 0。

### Step 3: 选择九项白名单角色并填写 payload
**来源**: `[FROM_PRD]` — thin_prd 第 2、3 项。

**可观测行为**: 文档逐项列出九个角色，并说明 `sprint_dir/base_repo/branch` 必填、`base_sha` 可省略且由生产 Brain 解析。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge.md','utf8');for(const x of ['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge','sprint_dir','base_repo','branch','base_sha'])if(!s.includes(x))process.exit(1)"`

**硬阈值**: 九角色和四字段全部出现；以上命令 exit 0。

### Step 4: 识别派发失败后的自动回滚
**来源**: `[FROM_PRD]` — thin_prd 第 4 项。

**可观测行为**: 文档明确派发抛错或未返回 LAUNCHED 时，新建资源按 run→failed、session→closed、task→cancelled 回滚。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge.md','utf8');for(const x of ['run → failed','session → closed','task → cancelled'])if(!s.includes(x))process.exit(1)"`

**硬阈值**: 三个状态映射字面齐全；以上命令 exit 0。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误把 `base_sha` 写成必填。
- 重复提交: 检查九角色是否重复或遗漏。
- 中途中断: N/A，静态文档无执行中状态。
- 边界值: 检查远端无 token 场景是否被错误描述为可放行。
发现分级: P0/P1 → 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
DOC=docs/current/attempt-run-bridge.md
test -f "$DOC"
node - "$DOC" <<'NODE'
const fs = require('fs');
const s = fs.readFileSync(process.argv[2], 'utf8');
const groups = [
  ['POST /api/brain/harness/attempt-run', 'GET /api/brain/harness/attempt-run/:id'],
  ['internalAuthOrLoopback', 'Authorization: Bearer', 'CECELIA_INTERNAL_TOKEN'],
  ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge'],
  ['sprint_dir', 'base_repo', 'branch', 'base_sha'],
  ['run → failed', 'session → closed', 'task → cancelled'],
];
for (const group of groups) for (const term of group) {
  if (!s.includes(term)) throw new Error(`缺少文档契约词项: ${term}`);
}
if (!/[\u4e00-\u9fff]/u.test(s)) throw new Error('文档必须为中文');
NODE
npx vitest run --no-cache sprints/coding-harness-20260831052812-3dmx7y/tests/attempt-run-bridge-doc.test.ts
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260831052812-3dmx7y/tests/attempt-run-bridge-doc.test.ts` | `说明两个端点及鉴权方式`、`完整列出九项角色白名单`、`说明 payload 必填字段与 base_sha 省略语义`、`说明派发失败自动回滚状态` | 目标文档尚不存在，至少 4 个测试失败 |

## Notes

- contract-gate: 使用 Cecelia 仓内代码层 Contract Gate；合同断言仅验证冻结文档范围。
- implementation baseline: `3c865b0f86c5f3d95bbebf6cb2d73928b565919b`，不以角色 checkout 信息替换。
