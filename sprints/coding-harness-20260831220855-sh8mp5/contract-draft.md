# Sprint Contract Draft (Round 1)

## 合同基线与范围

- 权威实现基线：`perfectuser21/cecelia@0f52356135922cf5031406dae629211837c3de92`。本合同、实现与验收均以此 SHA 为准；角色工作区 SHA 不替代该基线。
- 仅新增 `docs/current/attempt-run-bridge-usage.md`；不修改代码、配置、既有文档或 API 行为。
- `[MAP_NOT_CONFIGURED]`：任务未配置可用的 Unified Map scope/repo，因此没有 `must_run_assertions`；不回退到领域硬编码。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD字面）

N/A — 本任务只新增既有端点的使用说明，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试）

- [`packages/brain/src/routes/__tests__/harness-attempt-run.test.js`] → 角色白名单封闭：包含九个执行角色，永不包含 commander/publisher。
- [`packages/brain/src/middleware/internal-auth.test.js`] → loopback 与远端在 token 配置状态下均执行严格 Bearer 鉴权。
- `[累积FR]` 本 line 暂无历史。
- registry：现有 API、DB 与测试 registry 可读；本次不定义新 schema，测试沿用 Vitest `describe/it/expect`。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文说明，覆盖创建/查询、鉴权、九角色、payload 与派发失败回滚。 |
| NFR（做得多好） | 内容可机械核对，集中单页，不展示真实 token，不产生代码 diff。 |
| Invariant（永不违反） | 两端点均说明鉴权；凭据只引用环境变量名；不写死真实秘密；不改运行行为。 |
| 判定点（怎么知道） | 以权威基线中的路由与中间件源码为事实源，并以冻结 Vitest 逐项核对文档。 |
| 保质期（何时过期） | 白名单、字段、鉴权或回滚实现变化时文档即需同步更新，由对应 Brain 变更负责人维护。 |
| 死亡告警（停了谁知道） | Sprint Tests/合同测试失败即由 CI 向 PR 作者报告。 |
| 失败语义（挂了怎么办） | 任一必需章节或逐项断言缺失即阻塞交付，不以模糊措辞降级放行。 |
| 效果确认（已发≠已生效） | 直接读取候选提交中的目标文档，核对内容及唯一变更文件。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节、错字段或错角色 | 测试非零退出并阻塞合并 | 是，修正文档后可重复执行 | 无降级 |
| 候选 diff 含范围外文件 | 验收非零退出并阻塞合并 | 是，移除越界变更后重跑 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入面。

## 判定点 notes

- contract-gate: applicable (`packages/brain/src/lib/contract-gate.js` exists)
- judgment-pending-user: N/A

## 真实调用方请求 shape

本任务不改变调用方 shape；说明文档必须按生产中间件固定认证头：`Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。创建请求的 JSON 顶层包含 `role`、`title`、`payload`；`payload` 中分别列明 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略且由生产 Brain 自解析。查询请求以路径参数 `:id` 传 attempt id，不使用 body 认证或 body tenant 字段。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A；任务只交付说明文档，不派发真实 attempt。）

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 接缝清单

（本单不改变真实系统接缝；对宿主与远端 Bearer 义务分别作静态文档验收，N/A。）

## Golden Path

独立小路（无父路）

[读者打开说明] → [选择创建或查询] → [按位置完成鉴权] → [填写合法角色与 payload] → [理解失败回滚出口]

### Step 1: 区分创建与查询用途
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 项。

**可观测行为**: 读者看到 `POST /api/brain/harness/attempt-run` 用于异步创建/派发单角色 attempt，`GET /api/brain/harness/attempt-run/:id` 用于按 id 查询状态与结构化结果。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8');for(const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','创建','查询'])if(!s.includes(x))process.exit(1)"
```
**硬阈值**: 两个端点及各自用途四项全部命中；验证命令 exit 0。

### Step 2: 分别理解宿主与远端 Bearer 义务
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 项及本次 task description 的独立证明要求。

**可观测行为**: 文档明确两端点使用 `internalAuthOrLoopback`，并分别写明宿主请求与远端请求必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`；本机开发 loopback 例外不被外推。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8');for(const re of [/internalAuthOrLoopback/,/宿主[^。\n]*必须[^。\n]*Bearer[^。\n]*CECELIA_INTERNAL_TOKEN/,/远端[^。\n]*必须[^。\n]*Bearer[^。\n]*CECELIA_INTERNAL_TOKEN/,/loopback[^。\n]*(开发|本机)/i])if(!re.test(s))process.exit(1)"
```
**硬阈值**: 中间件、宿主义务、远端义务和 loopback 边界分别命中；验证命令 exit 0。

### Step 3: 选择九项合法角色
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项；精确名称取自权威基线 `ALLOWED_ROLES`。

**可观测行为**: 独立章节恰好列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge` 九项，不把 `commander` 或 `publisher` 写成合法角色。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8');const sec=s.match(/## 角色白名单\n([\s\S]*?)(?=\n## )/);if(!sec)process.exit(1);const got=[...sec[1].matchAll(/^- `([^`]+)`$/gm)].map(x=>x[1]);const want=['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge'];if(JSON.stringify(got)!==JSON.stringify(want))process.exit(1)"
```
**硬阈值**: 白名单条目数量恰为 9 且顺序与权威数组一致；验证命令 exit 0。

### Step 4: 分别识别 payload 字段义务
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项及 task description 的逐字段证明要求。

**可观测行为**: 文档分别声明 `sprint_dir`、`base_repo`、`branch` 必填；另行声明 `base_sha` 可省略，省略后由生产 Brain 自解析，且不把工作区 SHA 当权威实现基线。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8');for(const f of ['sprint_dir','base_repo','branch']){if(!new RegExp('`'+f+'`[^。\\n]*必填').test(s))process.exit(1)}if(!/`base_sha`[^。\n]*可省略[^。\n]*生产 Brain[^。\n]*自解析/.test(s))process.exit(1)"
```
**硬阈值**: 三个必填字段与一个可省略字段各有独立断言；验证命令 exit 0。

### Step 5: 理解派发失败的自动回滚出口
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项。

**可观测行为**: 读者看到派发抛错或未返回 `LAUNCHED` 时，自动收敛为 `run→failed`、`session→closed`、`task→cancelled`，且文档不承诺额外重试或补偿。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8');for(const x of ['run→failed','session→closed','task→cancelled'])if(!s.includes(x))process.exit(1)"
```
**硬阈值**: 三个状态出口全部命中；验证命令 exit 0。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
DOC='docs/current/attempt-run-bridge-usage.md'
BASE_SHA='0f52356135922cf5031406dae629211837c3de92'
test -f "$DOC"
node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)" "$DOC"
npx vitest run --no-cache sprints/coding-harness-20260831220855-sh8mp5/tests/attempt-run-bridge-usage.test.ts
CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD)
[ "$CHANGED" = "$DOC" ] || { echo "FAIL: 范围外变更: $CHANGED"; exit 1; }
echo 'OK: attempt-run 桥接说明合同验收通过'
```

**通过标准**: 文档存在且含中文；冻结 Vitest 全过；相对权威实现基线唯一变更文件为目标文档；脚本 exit 0。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误把 `commander`、`publisher` 写入白名单。
- 重复提交: 检查同一字段在示例与字段表中是否出现互相矛盾的必填性。
- 中途中断: N/A — 静态文档无运行中断状态。
- 边界值: 检查 loopback 例外是否被误述为生产宿主或远端免令牌。
发现分级: P0/P1（泄露凭据、错误鉴权或错误字段会直接误导调用方）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260831220855-sh8mp5/tests/attempt-run-bridge-usage.test.ts` | `分别说明创建与查询端点用途`；`分别证明宿主和远端必须携带 Bearer`；`精确列出九项角色白名单`；`分别声明三个必填字段和可省略 base_sha`；`写明派发失败的三个自动回滚终态` | 目标文档尚不存在，5 个测试失败 |

