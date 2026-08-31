# Sprint Contract Draft (Round 3)

## Notes

- 权威实现基线：`perfectuser21/cecelia@0f52356135922cf5031406dae629211837c3de92`；所有产品 diff 均相对此 SHA 计算，禁止用角色 checkout SHA 替换。
- `[MAP_NOT_CONFIGURED]`：task payload 未提供可用的 map scope/repo，故无 `must_run_assertions`，不回退到领域硬编码。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: N/A）

N/A — 本任务只新增说明文档，不修改 HTTP 响应或 API 行为。

## 已知约束

- [`packages/brain/src/routes/__tests__/harness-attempt-run.test.js`] → 角色白名单封闭且恰为九项；Router 同时挂载创建与查询路径。
- [`packages/brain/src/middleware/internal-auth.test.js`] → `internalAuthOrLoopback` 对生产/非 loopback 请求执行内部令牌保护。
- [累积FR] 本 line 暂无历史。
- [Unified Map] `[MAP_NOT_CONFIGURED]`，无 must-run assertions、fact revisions 或 freshness 证据。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/` 新增一页中文说明，准确覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 单页集中、可机械核验、不包含真实 token，产品变更严格只有目标文档。 |
| Invariant（永不违反） | 不改代码/配置/既有文档；不泄露凭据；不虚构 API 行为。 |
| 判定点（怎么知道） | 以冻结基线的生产路由常量、鉴权中间件及回滚 SQL 为权威来源。 |
| 保质期（何时过期） | 生产端点、角色、字段或回滚语义改变时，由对应代码变更同步更新文档。 |
| 死亡告警（停了谁知道） | 冻结测试与产品 diff 闸在 CI 中失败并阻塞交付。 |
| 失败语义（挂了怎么办） | 任一内容断言或唯一产品文件断言失败即退出非零，不放行。 |
| 效果确认（已发≠已生效） | 读取候选树中的真实文档并逐项断言；同时核对基线到候选的产品 diff。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或内容不完整 | 验收命令退出非零 | 是 | 无降级，阻塞交付 |
| 产品 diff 出现额外文件 | 验收命令退出非零并打印差异 | 是 | 无降级，收敛回单文档范围 |

### 输入对抗面

N/A — 本任务不新增或修改任何对外 agent/API 输入面。

## Golden Path

独立小路（无父路）

[读者打开说明] → [选择创建/查询并正确鉴权] → [提交合法角色与 payload] → [理解派发失败终态]

### Step 1: 读者找到中文说明并区分两个端点
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步与 A1/A2。

**可观测行为**: 文档位于 `docs/current/attempt-run-bridge-usage.md`，明确 POST 用于异步创建/派发，GET 用于按 attempt id 查询结构化状态/结果。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8');for(const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','创建','查询'])if(!s.includes(x))process.exit(1);if(!/[一-龥]/.test(s))process.exit(1)"`

**硬阈值**: 目标文件存在、含中文、两个端点及两种用途全部命中；验证命令 exit 0。

### Step 2: 读者按调用位置完成鉴权
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步与 A2。

**可观测行为**: 文档说明两端点均使用 `internalAuthOrLoopback`，宿主/远端必须发送 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，且不展示真实凭据。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8');for(const x of ['internalAuthOrLoopback','Bearer CECELIA_INTERNAL_TOKEN','宿主','远端'])if(!s.includes(x))process.exit(1)"`

**硬阈值**: 四项鉴权语义全部出现且无 token 字面值；验证命令 exit 0。

### Step 3: 读者获得九角色及 payload 规则
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步与 A3/A4。

**可观测行为**: 文档在 `## 角色白名单` 章节以九条列表且仅以这九条列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，并说明 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略并由生产 Brain 自解析。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8');const e=['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge'];const m=s.match(/^## 角色白名单\\s*$([\\s\\S]*?)(?=^## |\\s*$)/m);if(!m)process.exit(1);const a=[...m[1].matchAll(/^- \\`([^\\`]+)\\`\\s*$/gm)].map(x=>x[1]);if(JSON.stringify(a)!==JSON.stringify(e))process.exit(1);for(const x of ['sprint_dir','base_repo','branch','base_sha','可省略','生产 Brain','自解析'])if(!s.includes(x))process.exit(1)"`

**硬阈值**: 角色章节解析结果严格等于九项权威数组（长度 9，重复、遗漏或额外项均失败），payload 三个必填字段与 base_sha 省略语义全部命中；验证命令 exit 0。

### Step 4: 读者理解派发失败自动回滚
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 步与 A5。

**可观测行为**: 文档只承诺派发失败后的 `run→failed`、`session→closed`、`task→cancelled` 三个状态出口。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8');for(const x of ['run→failed','session→closed','task→cancelled'])if(!s.includes(x))process.exit(1)"`

**硬阈值**: 三个终态逐字全部命中；验证命令 exit 0。

### Step 5: 候选产品 diff 保持冻结范围
**来源**: `[AI_ADDED]` — 将 A6 的“不改任何代码”转换为不可被 Harness 冻结合同产物污染的产品 diff 闸。

**可观测行为**: 相对权威实现基线计算 diff；只逐路径排除 `contract-draft.md`、`contract-dod.md`、`tests/attempt-run-bridge-usage.test.ts`、`task-plan.json` 与 `.brain-result.json`（根目录或 sprint 内，若存在）。绝不排除整个 sprint 目录；目录下任意其他文件必须保留并导致失败。

**验证命令**: `bash -c 'BASE=0f52356135922cf5031406dae629211837c3de92; S=sprints/coding-harness-20260831220855-sh8mp5; F(){ grep -Fvx -e "$S/contract-draft.md" -e "$S/contract-dod.md" -e "$S/tests/attempt-run-bridge-usage.test.ts" -e "$S/task-plan.json" -e "$S/.brain-result.json" -e ".brain-result.json"; }; git diff --name-only "$BASE"...HEAD | F | diff -u <(printf "%s\\n" docs/current/attempt-run-bridge-usage.md) -; if printf "%s\\n" "$S/contract-draft.md" "$S/arbitrary-extra.txt" | F | diff -u /dev/null -; then exit 1; fi'`

**硬阈值**: 仅六个显式路径可排除；合成的 `arbitrary-extra.txt` 必须穿过过滤器并使空期望 diff 非零；真实产品 diff 仅含目标文档。

## 真实调用方请求 shape

N/A — 本任务只记录既有调用约定，不新增或修改设备/agent 到服务端的请求 shape；文档中的鉴权与字段逐字来自冻结基线生产路由。

## 禁 mock 边清单

（本单纯文档改动，不触及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本任务不改变真实系统接缝；仅验证文档与冻结基线约定一致，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否把 `base_sha` 误写为必填。
- 重复提交: N/A，纯文档无提交入口。
- 中途中断: N/A，纯文档无运行过程。
- 边界值: 检查九角色是否重复、遗漏或混入 `commander`/`publisher`。
发现分级: P0/P1（凭据泄露或直接误导生产调用）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=0f52356135922cf5031406dae629211837c3de92
SPRINT_PATH=sprints/coding-harness-20260831220855-sh8mp5
DOC=docs/current/attempt-run-bridge-usage.md

node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');if(!/[一-龥]/.test(s))throw Error('正文缺中文');for(const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','internalAuthOrLoopback','Bearer CECELIA_INTERNAL_TOKEN','宿主','远端'])if(!s.includes(x))throw Error('缺内容: '+x)" "$DOC"
node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');const e=['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge'];const m=s.match(/^## 角色白名单\\s*$([\\s\\S]*?)(?=^## |\\s*$)/m);if(!m)throw Error('缺角色白名单章节');const q=String.fromCharCode(96);const a=m[1].split('\\n').filter(x=>x.startsWith('- '+q)&&x.endsWith(q)).map(x=>x.slice(3,-1));if(JSON.stringify(a)!==JSON.stringify(e))throw Error('角色白名单必须恰为九项')" "$DOC"
node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');const q=String.fromCharCode(96);for(const f of ['sprint_dir','base_repo','branch'])if(!new RegExp(q+f+q+'[^\\n]{0,40}必填').test(s))throw Error('必填语义缺失: '+f);if(!new RegExp(q+'base_sha'+q+'[^\\n]{0,50}可省略').test(s)||!/生产 Brain[^\n]{0,40}自解析/.test(s))throw Error('base_sha 语义错误');for(const x of ['run→failed','session→closed','task→cancelled'])if(!s.includes(x))throw Error('缺回滚终态: '+x)" "$DOC"

filter_frozen(){ grep -Fvx -e "$SPRINT_PATH/contract-draft.md" -e "$SPRINT_PATH/contract-dod.md" -e "$SPRINT_PATH/tests/attempt-run-bridge-usage.test.ts" -e "$SPRINT_PATH/task-plan.json" -e "$SPRINT_PATH/.brain-result.json" -e ".brain-result.json"; }
git diff --name-only "$BASE_SHA"...HEAD | filter_frozen > /tmp/attempt-run-product-files
printf '%s\n' "$DOC" > /tmp/attempt-run-expected-files
diff -u /tmp/attempt-run-expected-files /tmp/attempt-run-product-files
if printf '%s\n' "$SPRINT_PATH/contract-draft.md" "$SPRINT_PATH/arbitrary-extra.txt" | filter_frozen | diff -u /dev/null -; then
  echo 'FAIL: sprint 任意额外文件被错误排除'
  exit 1
fi
echo 'OK: attempt-run 桥接说明及唯一产品 diff 验收通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 端点与鉴权 | `sprints/coding-harness-20260831220855-sh8mp5/tests/attempt-run-bridge-usage.test.ts` | `区分创建与查询端点并说明 internalAuthOrLoopback 鉴权` | 目标文档尚不存在，readFileSync 抛 ENOENT |
| 九角色白名单 | `sprints/coding-harness-20260831220855-sh8mp5/tests/attempt-run-bridge-usage.test.ts` | `角色白名单恰好列出九项生产角色` | 目标文档尚不存在，readFileSync 抛 ENOENT |
| diff 封闭性 | `sprints/coding-harness-20260831220855-sh8mp5/tests/attempt-run-bridge-usage.test.ts` | `产品 diff 过滤器不吞掉 sprint 目录任意额外文件` | 错误的整目录过滤会吞掉 arbitrary-extra.txt 并使断言失败 |
| payload 语义 | `sprints/coding-harness-20260831220855-sh8mp5/tests/attempt-run-bridge-usage.test.ts` | `payload 必填字段与 base_sha 可省略语义准确` | 目标文档尚不存在，readFileSync 抛 ENOENT |
| 自动回滚 | `sprints/coding-harness-20260831220855-sh8mp5/tests/attempt-run-bridge-usage.test.ts` | `派发失败自动回滚写明三个终态` | 目标文档尚不存在，readFileSync 抛 ENOENT |
