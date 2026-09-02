# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD 字面）

N/A — 本任务只新增说明文档，不修改或调用 HTTP API。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → 路由同时注册 `/attempt-run` 与 `/attempt-run/:attemptId`。
- [packages/brain/src/middleware/internal-auth.test.js] → `internalAuthOrLoopback` 区分未配置 token 时的开发机 loopback 与远端请求。
- [累积 FR] 本 line 暂无历史。
- Unified Map: `[MAP_NOT_CONFIGURED]`（task payload 未提供可用的 map_scope/map_repo 字符串）；must_run_assertions 为空。
- implementation baseline: `7a156f791feca8815bfabfbadce2ad874acf02af`（权威来源为 inputs.implementation_baseline；PRD E2E 注释中的旧 SHA 不用于验收）。

gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-bridge-guide.md` 新增中文说明，准确覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 四节完整、角色恰好九项、凭据只写变量名而不写令牌值。 |
| Invariant（永不违反） | 不改代码、配置、测试或既有文档；不硬编码凭据；基线固定为权威 implementation baseline。 |
| 判定点（怎么知道） | 文档内容以生产路由与鉴权中间件为权威，并由冻结测试逐项断言。 |
| 保质期（何时过期） | 端点、角色或鉴权实现变化时由对应代码变更同步更新文档。 |
| 死亡告警（停了谁知道） | 冻结测试在 Sprint Tests 中失败并阻塞合入。 |
| 失败语义（挂了怎么办） | 任一章节、角色或终态缺失即验收失败，不降级放行。 |
| 效果确认（已发≠已生效） | 候选树中读取文档正文并核对四节及唯一文件 diff。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或事实不符 | 测试非零退出并阻塞合入 | 是 | 无降级 |
| 候选包含范围外文件 | diff 校验非零退出并阻塞合入 | 是 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入入口。

## Golden Path

独立小路（无父路）

[打开说明] → [理解端点与鉴权] → [选择角色并构造 payload] → [识别派发失败终态]

### Step 1: 打开中文桥接说明
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」与「预期受影响文件」。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 存在，标题为《attempt-run 桥接使用说明》，正文为中文。

**验证命令**: `node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!/^# attempt-run 桥接使用说明/m.test(s)||!/[\u4e00-\u9fff]/.test(s))process.exit(1)"`

**硬阈值**: 文件存在、标题精确匹配且至少包含一个中文字符；由上述命令执行断言。

### Step 2: 理解两个端点及鉴权
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1-2 项。

**可观测行为**: 文档分别解释 POST 创建与 GET 查询用途，并明确 `internalAuthOrLoopback`、loopback 边界和宿主/远端 Bearer 要求。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','internalAuthOrLoopback','Authorization: Bearer <CECELIA_INTERNAL_TOKEN>'])if(!s.includes(x))process.exit(1)"`

**硬阈值**: 四个字面契约全部出现；由上述命令执行断言。

### Step 3: 选择角色并构造 payload
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3-4 项；角色名按生产 `ALLOWED_ROLES` 抄录。

**可观测行为**: 角色白名单逐项列出且恰好九项；payload 明确 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略并由生产 Brain 自解析。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');const roles=['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge'];for(const r of roles)if(!s.includes('- \x60'+r+'\x60'))process.exit(1);for(const f of ['sprint_dir','base_repo','branch','base_sha','可省略','生产 Brain 自解析'])if(!s.includes(f))process.exit(1)"`

**硬阈值**: 九项角色和六个 payload 关键短语全部出现；由上述命令执行断言。

### Step 4: 识别派发失败终态
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 项。

**可观测行为**: 文档同时说明 `run→failed`、`session→closed`、`task→cancelled`，不遗漏任一对象。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['run→failed','session→closed','task→cancelled'])if(!s.includes(x))process.exit(1)"`

**硬阈值**: 三个终态字面值全部出现；由上述命令执行断言。

## 真实调用方请求 shape

N/A — 本 sprint 不发起真实请求，只记录生产调用约定；不得执行 attempt-run 派发。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块、生命周期或 DB 写边，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A；PRD 明确禁止真实 attempt-run 派发。）

## 接缝清单

无接缝；本任务只对候选 Git 树中的中文文档做静态可执行验收。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=7a156f791feca8815bfabfbadce2ad874acf02af
DOC=docs/current/attempt-run-bridge-guide.md
node -e "const fs=require('fs');const s=fs.readFileSync(process.argv[1],'utf8');if(!/^# attempt-run 桥接使用说明/m.test(s)||!/[\u4e00-\u9fff]/.test(s))process.exit(1);for(const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','internalAuthOrLoopback','Authorization: Bearer <CECELIA_INTERNAL_TOKEN>','sprint_dir','base_repo','branch','base_sha','可省略','生产 Brain 自解析','run→failed','session→closed','task→cancelled'])if(!s.includes(x))process.exit(1)" "$DOC"
node -e "const fs=require('fs');const s=fs.readFileSync(process.argv[1],'utf8');const roles=['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge'];const section=(s.match(/## 角色白名单[\s\S]*?(?=\n## |$)/)||[''])[0];const listed=[...section.matchAll(new RegExp('^- \\x60([^\\x60]+)\\x60$','gm'))].map(m=>m[1]);if(JSON.stringify(listed)!==JSON.stringify(roles))process.exit(1)" "$DOC"
mapfile -t CHANGED < <(git diff --name-only --diff-filter=ACMRT "$BASE_SHA"...HEAD)
[ "${#CHANGED[@]}" -eq 1 ]
[ "${CHANGED[0]}" = "$DOC" ]
```

**通过标准**: 脚本 exit 0；相对权威 implementation baseline 仅新增目标文档。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否把远端误写成免 token。
- 重复提交: N/A，纯文档无提交入口。
- 中途中断: N/A，纯文档无运行流程。
- 边界值: 检查九项角色是否因名称包含连字符而误计数。
发现分级: P0/P1（凭据泄露或鉴权误导）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 中文文档与端点鉴权 | `sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts` | 中文标题并覆盖两个端点与鉴权边界 | 文档尚不存在，读取时报 ENOENT |
| 九角色与 payload | `sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts` | 恰好列出九项角色并说明 payload 必填字段 | 文档尚不存在，读取时报 ENOENT |
| 失败回滚 | `sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts` | 同时说明派发失败的三个终态 | 文档尚不存在，读取时报 ENOENT |
| 变更范围 | `sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts` | 唯一产品交付文件是桥接说明文档 | 文档尚不存在，断言失败 |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- 文档实施阶段唯一允许新增的产品文件是 `docs/current/attempt-run-bridge-guide.md`；合同工件属于 Harness 治理产物。
