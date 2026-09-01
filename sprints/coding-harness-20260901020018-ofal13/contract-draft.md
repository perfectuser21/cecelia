# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD 字面）

N/A — 本任务仅新增使用说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [sprint-prd.md / Invariant 约束] → secrets 不硬编码、不进 git、不进日志；远端调用不得被描述为免鉴权。
- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → POST 与 GET 路径及 `ALLOWED_ROLES` 以 implementation baseline `18cc9dae0611554b6f38ae0239c591449a259229` 为准。
- [累积 FR] → 本 line 暂无历史。
- context-manifest: unavailable（PRD 未提供 journey_id）。
- [MAP_NOT_CONFIGURED] task payload 未配置 map_scope/map_repo；不回退到领域硬编码。

gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接使用说明，覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 四节清晰；九角色逐项列出；相对 implementation baseline 仅新增目标文档与 sprint 冻结合同产物。 |
| Invariant（永不违反） | 不硬编码 token；不把远端写成免鉴权；不修改生产代码或既有文档。 |
| 判定点（怎么知道） | 由冻结 Vitest 与 E2E 脚本逐字解析文档并核对集合、字段语义和回滚三元组。 |
| 保质期（何时过期） | 角色、payload 或回滚合同变更时，由对应 API 变更负责人同步修订本页。 |
| 死亡告警（停了谁知道） | 文档契约测试在 Sprint Tests 失败，PR 作者与 reviewer 当次 CI 即知。 |
| 失败语义（挂了怎么办） | 任一必备章节、角色、字段或回滚状态缺失即阻塞交付，不降级放行。 |
| 效果确认（已发≠已生效） | 验收读取提交后的真实文档，严格核对四节和完整集合。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或语义错误 | 测试非零退出并阻塞合入 | 是，修正文档后可重复执行 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入处理面。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期或 DB 写路径，N/A。）

## 真实调用方请求 shape

本任务不修改调用 shape；文档必须按 implementation baseline 记录：宿主或远端请求使用 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，POST body 顶层含 `role`，其 `payload` 对象必须含 `sprint_dir`、`base_repo`、`branch`，`base_sha` 可省略并由生产 Brain 自解析。loopback 仅在未配置 token 且非生产环境时可免 token；不得将该例外扩展到宿主或远端。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A；任务只验证说明文档，不执行生产派发。）

## Golden Path

独立小路（无父路）

[阅读说明] → [确认鉴权与端点] → [按九角色及 payload 规则组装请求] → [查询 attempt] → [识别失败回滚]

### Step 1: 调用方找到两个桥接端点及鉴权规则
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1-2 项。

**可观测行为**: 文档的“端点用途与鉴权”一节分别解释 POST 创建/派发、GET 按 id 查询，并明确宿主或远端必须携带 Bearer token。

**验证命令**:
```bash
DOC=docs/current/attempt-run-bridge-guide.md; node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8"); for(const x of ["## 端点用途与鉴权","POST /api/brain/harness/attempt-run","GET /api/brain/harness/attempt-run/:id","internalAuthOrLoopback","Bearer CECELIA_INTERNAL_TOKEN"]) if(!s.includes(x)) throw new Error(`缺少 ${x}`)' "$DOC"
```

**硬阈值**: 五个字面锚点全部存在；上述命令 exit 0。

### Step 2: 调用方选择严格白名单中的角色
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项及 implementation baseline 的 `ALLOWED_ROLES`。

**可观测行为**: “角色白名单”一节以独立列表恰好列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge` 九项。

**验证命令**:
```bash
DOC=docs/current/attempt-run-bridge-guide.md; node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8"), sec=s.split("## 角色白名单")[1]?.split("\n## ")[0]||"", got=[...sec.matchAll(/^[-*] `([^`]+)`$/gm)].map(x=>x[1]), want=["canary","planner","proposer","reviewer","generator","generator-fix","evaluator","evaluator-evidence-repair","judge"]; if(JSON.stringify(got)!==JSON.stringify(want)) throw new Error(`角色集合不符: ${JSON.stringify(got)}`)' "$DOC"
```

**硬阈值**: 列表数量 = 9，顺序及字面值与冻结 baseline 完全相等；上述命令 exit 0。

### Step 3: 调用方区分 payload 必填字段与可省略字段
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3-4 项。

**可观测行为**: “payload 字段”一节明确 `sprint_dir`、`base_repo`、`branch` 必填，且 `base_sha` 可省略并由生产 Brain 自解析。

**验证命令**:
```bash
DOC=docs/current/attempt-run-bridge-guide.md; node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8"), sec=s.split("## payload 字段")[1]?.split("\n## ")[0]||""; for(const k of ["`sprint_dir`：必填","`base_repo`：必填","`branch`：必填","`base_sha`：可省略","由生产 Brain 自解析"]) if(!sec.includes(k)) throw new Error(`字段语义缺失: ${k}`)' "$DOC"
```

**硬阈值**: 三项且仅三项被明确标为必填，`base_sha` 明确可省略；上述命令 exit 0。

### Step 4: 调用方识别派发失败的原子收口
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 项。

**可观测行为**: “派发失败自动回滚”一节成组写明 `run→failed`、`session→closed`、`task→cancelled`。

**验证命令**:
```bash
DOC=docs/current/attempt-run-bridge-guide.md; node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8"), sec=s.split("## 派发失败自动回滚")[1]?.split("\n## ")[0]||""; for(const x of ["run→failed","session→closed","task→cancelled"]) if(!sec.includes(x)) throw new Error(`回滚状态缺失: ${x}`)' "$DOC"
```

**硬阈值**: 三个对象及终态在同一节全部存在；上述命令 exit 0。

### Step 5: 防止验证被宽松文本命中绕过
**来源**: `[AI_ADDED]` — 防止角色只在散文中重复、错误字段被同时标为必填等假绿。

**可观测行为**: 冻结测试按章节边界与精确列表解析，而非只做全文件模糊 grep。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260901020018-ofal13/tests/attempt-run-bridge-guide.test.ts
```

**硬阈值**: 4 个测试全部通过；命令 exit 0。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误把白名单外角色写成合法值。
- 重复提交: N/A，文档无提交动作。
- 中途中断: 从 GET 查询章节单独进入时，是否仍能追溯 id 来源。
- 边界值: 检查 `base_sha` 是否被误写成必填或完全省略。
发现分级: P0/P1（鉴权误导、角色或回滚错误）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
DOC=docs/current/attempt-run-bridge-guide.md
BASE_SHA=18cc9dae0611554b6f38ae0239c591449a259229
test -f "$DOC"
node - "$DOC" <<'NODE'
const fs = require('fs');
const s = fs.readFileSync(process.argv[2], 'utf8');
const sections = ['## 端点用途与鉴权','## 角色白名单','## payload 字段','## 派发失败自动回滚'];
for (const section of sections) if (!s.includes(section)) throw new Error(`缺少章节 ${section}`);
for (const text of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','internalAuthOrLoopback','Bearer CECELIA_INTERNAL_TOKEN']) if (!s.includes(text)) throw new Error(`缺少 ${text}`);
const roleSec = s.split('## 角色白名单')[1].split('\n## ')[0];
const got = [...roleSec.matchAll(/^[-*] `([^`]+)`$/gm)].map(m => m[1]);
const want = ['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge'];
if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`角色白名单不严格: ${JSON.stringify(got)}`);
const payloadSec = s.split('## payload 字段')[1].split('\n## ')[0];
for (const text of ['`sprint_dir`：必填','`base_repo`：必填','`branch`：必填','`base_sha`：可省略','由生产 Brain 自解析']) if (!payloadSec.includes(text)) throw new Error(`payload 语义缺失: ${text}`);
const rollbackSec = s.split('## 派发失败自动回滚')[1].split('\n## ')[0];
for (const text of ['run→failed','session→closed','task→cancelled']) if (!rollbackSec.includes(text)) throw new Error(`回滚语义缺失: ${text}`);
if (!/[\u4e00-\u9fff]/.test(s)) throw new Error('文档不是中文');
NODE
npx vitest run --no-cache sprints/coding-harness-20260901020018-ofal13/tests/attempt-run-bridge-guide.test.ts
NON_DOC=$(git diff --name-only "$BASE_SHA"...HEAD | grep -Ev '^(docs/current/attempt-run-bridge-guide\.md|sprints/coding-harness-20260901020018-ofal13/)' || true)
[ -z "$NON_DOC" ] || { echo "FAIL: 超出 docs-only 合同范围: $NON_DOC"; exit 1; }
echo "attempt-run 桥接使用说明验收通过"
```

通过标准：脚本 exit 0；四节、九角色精确集合、payload 必填/可省略语义、失败回滚三元组全部成立，且无范围外变更。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260901020018-ofal13/tests/attempt-run-bridge-guide.test.ts` | `包含两个端点用途与严格鉴权语义`、`角色白名单恰为九项且字面匹配`、`payload 仅三项必填且 base_sha 可省略`、`派发失败回滚三元组完整` | 目标文档尚不存在，4 tests failed |

## Notes

- implementation baseline 固定为 `18cc9dae0611554b6f38ae0239c591449a259229`；不得以本角色 checkout SHA 替代。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)

