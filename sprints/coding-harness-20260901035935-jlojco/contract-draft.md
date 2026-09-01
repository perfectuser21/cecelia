# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A）

N/A — 本任务只新增使用说明文档，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 路由必须保留 `/attempt-run` 与 `/attempt-run/:attemptId`。
- `packages/brain/src/middleware/internal-auth.test.js` → `internalAuthOrLoopback` 在 token 配置后严格鉴权，开发环境无 token 时仅 loopback 放行。
- `[累积FR] context-manifest: unavailable`（本任务未提供 journey_id，无法定位端点）。
- Unified Map: `[MAP_NOT_CONFIGURED]`（任务未提供 map_scope/map_repo）。

gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增 attempt-run 桥接中文使用说明，覆盖端点、鉴权、角色、payload 与失败回滚。 |
| NFR（做得多好） | 九项角色逐字完整；四类信息均可由冻结测试机械解析。 |
| Invariant（永不违反） | 仅改目标文档与本 Sprint 合同产物，不改代码。 |
| 判定点（怎么知道） | 由 Vitest 与 E2E 对标题、字段和值作精确断言。 |
| 保质期（何时过期） | 当 attempt-run 路由契约变化时，由该路由维护者同步更新文档。 |
| 死亡告警（停了谁知道） | 冻结测试或 E2E 失败会在 CI 中阻塞交付。 |
| 失败语义（挂了怎么办） | 任一必含节缺失即失败，不降级、不放行。 |
| 效果确认（已发≠已生效） | 从提交树读取目标文档并验证四节语义与仅文档范围。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或内容不完整 | 测试非零退出并阻塞交付 | 是 | 无降级 |
| 出现范围外文件变更 | E2E 非零退出并阻塞交付 | 是 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入接口。

## Golden Path

独立小路（无父路）

[读者打开文档] → [理解端点与鉴权] → [选择合法角色] → [组装 payload] → [理解失败回滚]

### Step 1：读者定位两个桥接端点及鉴权方式

**来源**: `[FROM_PRD]` — PRD“文档必含内容”第 1 项。

**可观测行为**: 文档明确区分 POST 异步派发与 GET 按 attempt id 轮询，并说明 `internalAuthOrLoopback` 及远端 Bearer token。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8'); for(const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','internalAuthOrLoopback','Authorization: Bearer','CECELIA_INTERNAL_TOKEN']) if(!s.includes(x)) process.exit(1)"
```

**硬阈值**: 五个字面锚点全部存在；验证命令 exit 0。

### Step 2：读者选择合法角色

**来源**: `[FROM_PRD]` — PRD“文档必含内容”第 2 项。

**可观测行为**: 文档逐字列出且仅将九个指定值称为角色白名单。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8'); for(const x of ['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge']) if(!s.includes('`'+x+'`')) process.exit(1)"
```

**硬阈值**: 九项角色全部以代码字面量出现；验证命令 exit 0。

### Step 3：读者组装 payload

**来源**: `[FROM_PRD]` — PRD“文档必含内容”第 3 项。

**可观测行为**: 文档明确 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略且由生产 Brain 自解析。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8'); for(const x of ['`sprint_dir`','`base_repo`','`branch`','`base_sha`','可省略','生产 Brain']) if(!s.includes(x)) process.exit(1)"
```

**硬阈值**: 六个语义锚点全部存在；验证命令 exit 0。

### Step 4：读者理解派发失败的原子回滚

**来源**: `[FROM_PRD]` — PRD“文档必含内容”第 4 项。

**可观测行为**: 文档明确派发失败时 run、session、task 分别进入 `failed`、`closed`、`cancelled`。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8'); for(const x of ['run','`failed`','session','`closed`','task','`cancelled`']) if(!s.includes(x)) process.exit(1)"
```

**硬阈值**: 三个资源及三个终态全部存在；验证命令 exit 0。

### Step 5：范围守卫

**来源**: `[AI_ADDED]` — 将 PRD“不改任何代码”转成提交树可执行断言，防止范围漂移。

**可观测行为**: 相对实现基线 `46221f91778af50e1be078f1e542ec5c17360126`，产品交付只新增目标文档；Sprint 合同产物不计产品代码。

**验证命令**:
```bash
git diff --name-only 46221f91778af50e1be078f1e542ec5c17360126...HEAD | awk '!/^sprints\/coding-harness-20260901035935-jlojco\// && $0!="docs/current/attempt-run-bridge-guide.md"{bad=1} END{exit bad}'
```

**硬阈值**: 范围外变更数为 0；验证命令 exit 0。

## 真实调用方请求 shape

N/A — 本任务只记录既有接口，不改变或调用生产接口。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本任务无真实世界接缝，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误称 GET 可派发角色。
- 重复提交: 检查同一角色或字段是否出现相互矛盾的定义。
- 中途中断: N/A，静态文档无运行中状态。
- 边界值: 检查九项角色是否恰好完整、连字符是否正确。
发现分级: P0/P1 → 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
DOC='docs/current/attempt-run-bridge-guide.md'
BASE_SHA='46221f91778af50e1be078f1e542ec5c17360126'
test -f "$DOC"
node - "$DOC" <<'NODE'
const fs = require('fs');
const s = fs.readFileSync(process.argv[2], 'utf8');
const groups = [
  ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','internalAuthOrLoopback','Authorization: Bearer','CECELIA_INTERNAL_TOKEN'],
  ['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge'].map(x => '`'+x+'`'),
  ['`sprint_dir`','`base_repo`','`branch`','`base_sha`','可省略','生产 Brain'],
  ['run','`failed`','session','`closed`','task','`cancelled`'],
];
for (const group of groups) for (const token of group) {
  if (!s.includes(token)) throw new Error(`缺少文档锚点: ${token}`);
}
if (!/[\u4e00-\u9fff]/.test(s)) throw new Error('文档缺少中文内容');
NODE
git diff --name-only "$BASE_SHA"...HEAD | awk '!/^sprints\/coding-harness-20260901035935-jlojco\// && $0!="docs/current/attempt-run-bridge-guide.md"{print "范围外变更: "$0; bad=1} END{exit bad}'
echo 'attempt-run 桥接文档 E2E 通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 端点与鉴权 | `sprints/coding-harness-20260901035935-jlojco/tests/attempt-run-bridge-guide.test.ts` | `说明两个端点用途与鉴权` | 目标文档不存在，测试失败 |
| 角色白名单 | `sprints/coding-harness-20260901035935-jlojco/tests/attempt-run-bridge-guide.test.ts` | `完整列出九项角色白名单` | 目标文档不存在，测试失败 |
| payload 字段 | `sprints/coding-harness-20260901035935-jlojco/tests/attempt-run-bridge-guide.test.ts` | `说明 payload 必填字段与 base_sha 省略规则` | 目标文档不存在，测试失败 |
| 失败回滚 | `sprints/coding-harness-20260901035935-jlojco/tests/attempt-run-bridge-guide.test.ts` | `说明派发失败的三资源回滚终态` | 目标文档不存在，测试失败 |

## Notes

- implementation baseline 固定为 `46221f91778af50e1be078f1e542ec5c17360126`，未使用 role checkout SHA 替换。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)。
