# Sprint Contract Draft (Round 1)

## Notes

- authoritative baseline: `1ef19bd6f70b79e14a20ecb0e37ba8492f71a029`
- `[MAP_NOT_CONFIGURED]`：任务未提供可用的 `map_scope`/`map_repo`，不回退到领域硬编码。
- registry 三类均为空，按 PRD 字面定义并标记 `[NEW_PATTERN]`。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- gp-anchor: skipped (product-map.json not found)
- 本任务仅新增 `docs/current/attempt-run-bridge.md`；禁止修改任何代码、配置或既有测试。

## Response Schema（推导来源: PRD字面）

N/A — 本 Sprint 只编写既有端点的中文使用说明，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试与累积 FR）

- `tests/gp/f1/step3-attempt-run-endpoint.test.js` → POST 异步派发、角色和必填参数校验、GET 结果查询。
- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 路由必须包含 `/attempt-run` 与 `/attempt-run/:attemptId`。
- `packages/brain/src/middleware/internal-auth.test.js` → `internalAuthOrLoopback` 的 loopback 与 Bearer 鉴权边界。
- context-manifest: unavailable（thin PRD 未提供 journey_id）。
- 铁律映射：仅文档变更；分支规则、凭据不入库、禁止代码变更由 DoD INV-1 至 INV-3 验证。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接说明，覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 四个主题均有独立二级标题；命令与字段可复制辨认。 |
| Invariant（永不违反） | 只新增目标文档；不改代码；不写入真实 token。 |
| 判定点（怎么知道） | 由冻结 Vitest 与 E2E 对标题、关键字、九角色精确集合和 git diff 范围机检。 |
| 保质期（何时过期） | 端点、白名单、鉴权或回滚实现变化时由对应 Brain 维护者同步更新。 |
| 死亡告警（停了谁知道） | 冻结测试或文档 E2E 在 CI 失败并阻塞合并。 |
| 失败语义（挂了怎么办） | 缺任一节、角色漂移、出现代码 diff 均失败并阻塞合并。 |
| 效果确认（已发≠已生效） | HEAD 树存在文档，Vitest 与 E2E 都读取并校验实际文件内容。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或字段 | 测试非零退出并阻塞合并 | 是 | 无降级 |
| 变更越出文档范围 | git diff 范围断言失败 | 是 | 撤销越权变更后重验 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入接口。

## Golden Path

独立小路（无父路）

[读者打开文档] → [理解端点与鉴权] → [选择合法角色并构造 payload] → [理解失败回滚]

### Step 1: 找到桥接端点与安全调用方式
**来源**: `[FROM_PRD]` — thin PRD 第 1 项“两个端点的用途、鉴权方式”。

**可观测行为**: 文档用中文分别说明 POST 异步派发与 GET 按 attempt id 轮询，并说明 `internalAuthOrLoopback`；宿主或远端请求携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。

**验证命令**: `node -e "const c=require('fs').readFileSync('docs/current/attempt-run-bridge.md','utf8');for(const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','internalAuthOrLoopback','Authorization: Bearer','CECELIA_INTERNAL_TOKEN'])if(!c.includes(x))process.exit(1)"`

**硬阈值**: 五个字面锚点全部存在；上述命令 exit 0。

### Step 2: 从九项白名单选择执行角色
**来源**: `[FROM_PRD]` — thin PRD 第 2 项“角色白名单九项”。

**可观测行为**: 文档逐项列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，并说明白名单外角色会被拒绝。

**验证命令**: `node -e "const c=require('fs').readFileSync('docs/current/attempt-run-bridge.md','utf8');const roles=['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge'];for(const r of roles)if(!c.includes('\`'+r+'\`'))process.exit(1)"`

**硬阈值**: 九项角色全部以代码字面量出现；上述命令 exit 0。

### Step 3: 构造 payload 并理解 base SHA 解析
**来源**: `[FROM_PRD]` — thin PRD 第 3 项“payload 必填字段，base_sha 可省略”。

**可观测行为**: 文档明确 `sprint_dir`、`base_repo`、`branch` 必填，并说明 `base_sha` 可省略且由生产 Brain 自解析。

**验证命令**: `node -e "const c=require('fs').readFileSync('docs/current/attempt-run-bridge.md','utf8');for(const x of ['sprint_dir','base_repo','branch','base_sha','可省略','生产 Brain'])if(!c.includes(x))process.exit(1)"`

**硬阈值**: 六个语义锚点全部存在；上述命令 exit 0。

### Step 4: 识别派发失败后的自动回滚
**来源**: `[FROM_PRD]` — thin PRD 第 4 项“派发失败自动回滚”。

**可观测行为**: 文档明确派发失败时 `run → failed`、`session → closed`、`task → cancelled`，避免遗留活跃资源。

**验证命令**: `node -e "const c=require('fs').readFileSync('docs/current/attempt-run-bridge.md','utf8');for(const x of ['run → failed','session → closed','task → cancelled'])if(!c.includes(x))process.exit(1)"`

**硬阈值**: 三条回滚终态全部存在；上述命令 exit 0。

## 真实调用方请求 shape

本 Sprint 不改调用协议；文档示例必须沿用生产入口：`Content-Type: application/json`，远端/宿主通过 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，正文包含 `role`、`title`、`payload`，payload 包含 `sprint_dir`、`base_repo`、`branch`，可选 `base_sha`。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块、生命周期或 DB 写边，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本单只描述既有接口，不修改真实世界接缝，N/A。）

## E2E 验收（最终 final-e2e 跑）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
DOC='docs/current/attempt-run-bridge.md'
test -f "$DOC"
node - "$DOC" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const c = fs.readFileSync(path, 'utf8');
const required = [
  'POST /api/brain/harness/attempt-run', 'GET /api/brain/harness/attempt-run/:id',
  'internalAuthOrLoopback', 'Authorization: Bearer', 'CECELIA_INTERNAL_TOKEN',
  'sprint_dir', 'base_repo', 'branch', 'base_sha', '可省略', '生产 Brain',
  'run → failed', 'session → closed', 'task → cancelled',
];
for (const item of required) if (!c.includes(item)) throw new Error(`缺少文档锚点: ${item}`);
const roles = ['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge'];
for (const role of roles) if (!c.includes(`\`${role}\``)) throw new Error(`缺少角色: ${role}`);
if (!/[\u4e00-\u9fff]/.test(c)) throw new Error('文档不是中文');
NODE
CHANGED=$(git diff --name-only 1ef19bd6f70b79e14a20ecb0e37ba8492f71a029...HEAD -- docs/current packages apps | sort)
[ "$CHANGED" = 'docs/current/attempt-run-bridge.md' ] || { echo "FAIL: 产品变更范围越界: $CHANGED"; exit 1; }
npx vitest run --no-cache sprints/coding-harness-20260831021639-oqz7bs/tests/attempt-run-bridge-doc.test.ts
```

通过标准：脚本 exit 0；文档四节、九角色与中文检查通过；相对权威 baseline 的产品变更只有目标文档。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260831021639-oqz7bs/tests/attempt-run-bridge-doc.test.ts` | `说明 POST 与 GET 端点及鉴权方式`；`列出九项角色白名单`；`说明 payload 必填字段与 base_sha 省略规则`；`说明派发失败的三项自动回滚` | 目标文档尚不存在，4 个 it 均因 ENOENT 失败 |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例是否误把 `base_sha` 写成必填。
- 重复提交: 检查九角色是否遗漏或重复造成歧义。
- 中途中断: N/A，静态文档无运行中状态。
- 边界值: 检查宿主/远端与本机 loopback 的鉴权边界是否混写。
发现分级: P0/P1（泄露凭据或错误指导生产鉴权）阻塞 merge；P2/P3 记录 findings。
