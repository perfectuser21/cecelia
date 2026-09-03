# Sprint Contract Draft (Round 1)

task_request_hash: `aecb99079a0f3f82a833c6ff55d42e5903af6050d73033b574511db5dfd00e4f`

## Response Schema（推导来源: N/A）

N/A — 本任务仅新增说明文档，无 HTTP 响应或数据模型变更。

## 已知约束（来自回归测试）

- `packages/brain/src/middleware/internal-auth.test.js` → `internalAuthOrLoopback` 在生产配置 token 后要求合法内部凭据。
- `packages/brain/src/routes/harness-attempt-run.js` → `ALLOWED_ROLES` 是本说明的九项角色权威来源。
- `[累积FR]` 本 line 暂无历史。
- Unified Map: `[MAP_NOT_CONFIGURED]`；task payload 没有可用的字符串 `map_scope` 与 `map_repo`，无 `must_run_assertions`。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-bridge.md` 用中文说明 attempt-run 两个端点、鉴权、九项角色、payload 与失败回滚。 |
| NFR（做得多好） | 四节独立、角色集合精确且不重复、内容可由脚本确定性验证。 |
| Invariant（永不违反） | 不提交真实 Token；不修改代码；实现基线固定为 `6a9030e27b6f1c7c9ab328c9c90ba08cbb74eebb`。 |
| 判定点（怎么知道） | N/A；只校验仓库文本，无外部真实状态推断。 |
| 保质期（何时过期） | 当两个端点、鉴权中间件、角色集合或 payload 合同变化时由其变更者同步更新。 |
| 死亡告警（停了谁知道） | 冻结测试及 E2E 在文档缺失或漂移时失败并阻塞 CI。 |
| 失败语义（挂了怎么办） | 任一内容或范围断言失败即阻塞，不降级放行。 |
| 效果确认（已发≠已生效） | 读取最终提交中的文档，逐节解析并核对封闭集合与负向约束。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节、角色漂移或错误声明 | 测试非零退出并阻塞交付 | 是，只读校验 | 无降级 |
| 出现范围外文件 | 范围 oracle 非零退出并阻塞交付 | 是，只读校验 | 无降级 |

### 输入对抗面

N/A；本任务不新增对外 agent 或输入入口。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## Golden Path

独立小路（无父路）

[读者进入说明] → [确认端点与鉴权] → [确认角色白名单] → [确认 payload] → [确认失败回滚]

### Step 1: 确认端点用途与鉴权
**来源**: `[FROM_PRD]` — `thin_prd` 第 1 项。

**可观测行为**: 文档说明 POST 发起运行、GET 按 id 查询状态；鉴权名为 `internalAuthOrLoopback`，宿主或远端必须使用 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，且不得写入真实 token。

**硬阈值**: 两个端点、鉴权名和 Bearer 环境变量引用全部出现；不得出现 `Bearer CECELIA_TOKEN` 或形如 `Bearer <字面密钥>` 的示例。

**验证命令**: `node sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge.test.ts` 中对应 Vitest 断言，并由下方 E2E 原样复核。

### Step 2: 确认九项角色白名单
**来源**: `[FROM_PRD]` — `thin_prd` 第 2 项；名称逐字取自 `packages/brain/src/routes/harness-attempt-run.js` 的 `ALLOWED_ROLES`。

**可观测行为**: 角色章节恰好列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，无重复、无第十项。

**硬阈值**: 解析后的角色数组与上述九项数组按顺序完全相等，集合大小恰为 9；任何缺项、重复项或额外项均失败。

**验证命令**: 下方 E2E 用 Node 解析 `## 角色白名单` 到下一二级标题之间的 Markdown 列表，并作深相等和负向差集断言。

### Step 3: 确认 payload 字段规则
**来源**: `[FROM_PRD]` — `thin_prd` 第 3 项。

**可观测行为**: 文档把 `sprint_dir`、`base_repo`、`branch` 明确标为必填；把 `base_sha` 明确标为可省略，并说明由生产 Brain 自解析。

**硬阈值**: 必填集合恰好为三项，`base_sha` 不得进入必填集合；不得出现“base_sha 必填”。

**验证命令**: 下方 E2E 解析 payload 表格并同时执行正向集合相等与负向排除断言。

### Step 4: 确认派发失败自动回滚
**来源**: `[FROM_PRD]` — `thin_prd` 第 4 项。

**可观测行为**: 文档同时明确 `run→failed`、`session→closed`、`task→cancelled`。

**硬阈值**: 三个状态收敛文本全部出现；不得把任一终态写为 completed、active 或 in_progress。

**验证命令**: 下方 E2E 对三个正向状态逐一断言，并对错误终态逐一作负向断言。

## 真实调用方请求 shape

本任务只记录生产调用约定，不新增调用方：宿主或远端以 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN` 鉴权；POST JSON 顶层含 `role`、`title`、`payload`，其中 payload 必填 `sprint_dir`、`base_repo`、`branch`，`base_sha` 可省略；GET 路径参数为 attempt id。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本单只校验文档，不执行生产派发，无真实世界接缝，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 在文档中搜索把 `base_sha` 误列为必填的表述。
- 重复提交: 检查角色列表是否重复列出同一角色。
- 中途中断: N/A；静态文档无运行中状态。
- 边界值: 检查角色列表少于或多于九项时冻结测试会失败。
发现分级: P0/P1 → 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
DOC='docs/current/attempt-run-bridge.md'
BASE_SHA='6a9030e27b6f1c7c9ab328c9c90ba08cbb74eebb'
HASH='aecb99079a0f3f82a833c6ff55d42e5903af6050d73033b574511db5dfd00e4f'
test -f "$DOC"
grep -q "$HASH" "$DOC"
node --input-type=module - "$DOC" <<'NODE'
import fs from 'node:fs';
import assert from 'node:assert/strict';
const text = fs.readFileSync(process.argv[2], 'utf8');
const section = name => text.match(new RegExp(`^## ${name}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'))?.[1] ?? '';
for (const name of ['端点与鉴权','角色白名单','payload 字段','派发失败自动回滚']) assert.ok(section(name), `缺章节: ${name}`);
for (const value of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','internalAuthOrLoopback','Bearer $CECELIA_INTERNAL_TOKEN']) assert.ok(section('端点与鉴权').includes(value), `缺正向项: ${value}`);
for (const value of ['Bearer CECELIA_TOKEN','可以省略 Bearer']) assert.ok(!section('端点与鉴权').includes(value), `出现禁用鉴权表述: ${value}`);
const roles = [...section('角色白名单').matchAll(/^- `([^`]+)`/gm)].map(m => m[1]);
const expectedRoles = ['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge'];
assert.deepEqual(roles, expectedRoles); assert.equal(new Set(roles).size, 9); assert.deepEqual(roles.filter(r => !expectedRoles.includes(r)), []);
const payload = section('payload 字段');
const required = [...payload.matchAll(/^\| `([^`]+)` \| 必填 \|/gm)].map(m => m[1]);
assert.deepEqual(required, ['sprint_dir','base_repo','branch']); assert.ok(!required.includes('base_sha')); assert.match(payload, /`base_sha` \| 可省略 \|[^\n]*生产 Brain 自解析/); assert.doesNotMatch(payload, /base_sha[^\n]*必填|必填[^\n]*base_sha/);
const rollback = section('派发失败自动回滚');
for (const value of ['run→failed','session→closed','task→cancelled']) assert.ok(rollback.includes(value), `缺正向回滚: ${value}`);
for (const value of ['run→completed','session→active','task→in_progress']) assert.ok(!rollback.includes(value), `出现错误回滚: ${value}`);
assert.match(text, /[\u4e00-\u9fff]/); assert.doesNotMatch(text, /Bearer\s+(?!\$CECELIA_INTERNAL_TOKEN\b)[A-Za-z0-9_-]{16,}/);
NODE
test "$(git diff --name-only 6a9030e27b6f1c7c9ab328c9c90ba08cbb74eebb...HEAD | grep -v '^docs/current/attempt-run-bridge.md$' | grep -v '^sprints/coding-harness-20260903033320-2se9fh/' | wc -l)" -eq 0
test "$(git diff --name-only 6a9030e27b6f1c7c9ab328c9c90ba08cbb74eebb...HEAD | grep '^docs/current/attempt-run-bridge.md$' | wc -l)" -eq 1
```

## Test Contract

task_request_hash: `aecb99079a0f3f82a833c6ff55d42e5903af6050d73033b574511db5dfd00e4f`

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge.test.ts` | `包含四个独立章节`；`端点与鉴权正负 oracle`；`角色白名单是恰好九项封闭集合`；`payload 必填与可省略规则正负 oracle`；`失败回滚正负 oracle`；`唯一交付文件范围 oracle` | 文档尚不存在，至少 1 个测试失败 |

## Notes

- contract-gate: 使用 Cecelia 仓库 `packages/brain/src/lib/contract-gate.js`。
- `thin_prd` 优先于补充 PRD：鉴权环境变量按生产源码写为 `CECELIA_INTERNAL_TOKEN`。
- 合同及冻结测试引用 task_request_hash `aecb99079a0f3f82a833c6ff55d42e5903af6050d73033b574511db5dfd00e4f`。
