# Sprint Contract Draft (Round 1)

## 合同边界与证据来源

- 权威 PRD：bundle `inputs.thin_prd`，由 `sprint-prd.md` 补充基线不变约束。
- 实现基线固定为 `bdaca81b5cbf78929fa3d8eeac2a24cae6113b98`；不得用角色 checkout 的 workspace base SHA 替换。
- Unified Map：`map_scope` 为空，标记 `[MAP_NOT_CONFIGURED]`，无 `must_run_assertions`。
- Registry：API registry 可用且 freshness=`fresh`；本 Sprint 不定义或修改 API schema。
- context-manifest：journey_id 为 `none`，无累积 FR。
- Contract Gate：`packages/brain/src/lib/contract-gate.js` 存在，适用代码层检查。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD字面）

N/A — 本任务只新增使用说明，不修改 HTTP 响应。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 两个 attempt-run 路由必须保持注册。
- `packages/brain/src/middleware/internal-auth.test.js` → loopback 与 Bearer 鉴权语义已有回归覆盖。
- `[累积FR]` 本 line 暂无历史。

## Golden Path

独立小路（无父路）

[读者打开说明] → [识别创建与查询端点] → [正确鉴权] → [按白名单与 payload 组装请求] → [理解失败回滚出口]

### Step 1: 读者找到唯一中文说明并识别两个端点用途

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 项与范围限定。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 存在，中文正文分别解释 POST 创建与 GET 查询。

**验证命令**:
```bash
node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');for(const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','创建','查询'])if(!s.includes(x))process.exit(1);if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"
```

**硬阈值**: 文档恰好覆盖 2 个目标端点；不得把同一路径的其他方法或其他 attempt-run 子端点列入目标端点清单。上述命令以闭合正向集合断言 2 项均存在；冻结测试另以负向样例证明漏任一项必失败。

### Step 2: 读者区分 loopback 与宿主/远端鉴权

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 项与边界情况。

**可观测行为**: 说明写明 `internalAuthOrLoopback`，并明确宿主/远端必须发送 `Authorization: Bearer CECELIA_INTERNAL_TOKEN`，不声称所有请求免鉴权。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['internalAuthOrLoopback','Authorization','Bearer CECELIA_INTERNAL_TOKEN','宿主','远端','必须'])if(!s.includes(x))process.exit(1);for(const bad of ['所有请求均可免鉴权','宿主可免鉴权','远端可免鉴权'])if(s.includes(bad))process.exit(1)"
```

**硬阈值**: 3 个禁止误导短语均不存在，6 个正向鉴权标记均存在；正向与负向 oracle 在同一命令内成对执行。

### Step 3: 读者只使用九项角色白名单

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项。

**可观测行为**: 角色白名单章节用一个封闭列表完整列出且仅列出九项原始拼写。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');const m=s.match(/<!-- ROLE_ALLOWLIST:BEGIN -->([\s\S]*?)<!-- ROLE_ALLOWLIST:END -->/);if(!m)process.exit(1);const got=[...m[1].matchAll(/^\s*- `([^`]+)`\s*$/gm)].map(x=>x[1]);const want=['planner','proposer','proposer-critic','generator','generator-critic','evaluator','evaluator-critic','reporter','reporter-critic'];if(JSON.stringify(got)!==JSON.stringify(want))process.exit(1)"
```

**硬阈值**: 封闭清单恰好 9 项，顺序与上列 `want` 完全相等；此 exact-equality 同时断言缺项、增项、重复项和改名均失败。

### Step 4: 读者正确组装 payload 并保持实现基线

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项。

**可观测行为**: payload 必填清单恰好为 `sprint_dir`、`base_repo`、`branch`；`base_sha` 明确可省略、由生产 Brain 自解析，且跨角色/GAN 轮次不变。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');const m=s.match(/<!-- REQUIRED_PAYLOAD:BEGIN -->([\s\S]*?)<!-- REQUIRED_PAYLOAD:END -->/);if(!m)process.exit(1);const got=[...m[1].matchAll(/^\s*- `([^`]+)`\s*$/gm)].map(x=>x[1]);if(JSON.stringify(got)!==JSON.stringify(['sprint_dir','base_repo','branch']))process.exit(1);for(const x of ['base_sha','可省略','生产 Brain','各角色','GAN 轮次','保持不变','不得替代实现基线'])if(!s.includes(x))process.exit(1);for(const bad of ['base_sha`（必填','base_sha 为必填','角色切换时重置实现基线'])if(s.includes(bad))process.exit(1)"
```

**硬阈值**: 必填字段封闭清单恰好 3 项且不含 `base_sha`；7 个基线语义标记存在，3 个冲突表述不存在。

### Step 5: 读者理解派发失败是三对象完整回滚

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 项与边界情况。

**可观测行为**: 文档在同一失败回滚章节列出 `run→failed`、`session→closed`、`task→cancelled`，并说明不是部分成功。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');const m=s.match(/<!-- ROLLBACK_STATES:BEGIN -->([\s\S]*?)<!-- ROLLBACK_STATES:END -->/);if(!m)process.exit(1);const got=[...m[1].matchAll(/^\s*- `([^`]+)`\s*$/gm)].map(x=>x[1]);if(JSON.stringify(got)!==JSON.stringify(['run→failed','session→closed','task→cancelled']))process.exit(1);if(!s.includes('不是部分成功'))process.exit(1)"
```

**硬阈值**: 回滚封闭清单恰好 3 项，exact-equality 同时拒绝漏项、增项和错误终态；并含“不是部分成功”。

## 断言总数与两两自洽结论

- Golden Path 正向行为断言恰好 5 条（B-01 至 B-05），对应五类读者信息；另有 2 条 Invariant 与 1 条范围行为，共 8 条 `[BEHAVIOR]`。
- 三个封闭计数：目标端点恰好 2、角色恰好 9、payload 必填恰好 3、回滚状态恰好 3。端点是用途清单；角色、字段、状态各在独立标记区，集合不相交，计数不会互相吞并。
- 每条正向 oracle 都有负向面：B-01 缺端点/中文失败；B-02 免鉴权误导失败；B-03 非九项 exact-equality 失败；B-04 `base_sha` 误列必填或基线重置失败；B-05 非三终态或部分成功失败。
- 两两推演：B-01 只约束端点用途，B-02 只约束鉴权，B-03/B-04/B-05 通过独立 BEGIN/END 区间计数；任一断言满足不会导致另一断言失败。B-04 明确 `base_sha` 可出现于说明文字但不得进入 REQUIRED_PAYLOAD 区间，消除了“存在 base_sha”与“必填恰好 3 项”的冲突。
- INV-1/INV-2 只读取规范文档，不改运行时；范围 oracle单独以完整 diff 路径集合约束，和交付文档存在性不冲突。

## 接缝清单

（本单纯文档改动，无真实世界接缝，N/A）

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A）

## 真实调用方请求 shape

N/A — 本 Sprint 不发起 API 请求，只记录生产调用契约；不新增或修改调用方。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接说明，覆盖 PRD 五类信息。 |
| NFR（做得多好） | 四个可定位章节；所有标识保持原始字面；唯一实现交付文件。 |
| Invariant（永不违反） | 不改代码；实现基线跨角色及 GAN 轮次不变。 |
| 判定点（怎么知道） | 封闭清单 exact-equality 与全文正负向词法 oracle。 |
| 保质期（何时过期） | 对应端点、鉴权、白名单、payload 或回滚契约变更时由该 API 维护者同步修订。 |
| 死亡告警（停了谁知道） | 冻结 Vitest 与 E2E 失败使 CI/Reviewer 在本次交付中获知。 |
| 失败语义（挂了怎么办） | 任一内容或范围断言失败即阻塞交付，不降级放行。 |
| 效果确认（已发≠已生效） | 从最终 Git 树读取文档并验证闭合集合；全仓 diff 验证无代码变更。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺项、增项或误导 | 验收非零退出并阻塞 | 是，只读断言 | 无 |
| 全仓 diff 出现范围外文件 | 验收非零退出并阻塞 | 是，只读断言 | 无 |

### 输入对抗面

N/A — 不新增对外 agent 或可写接口。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查读者是否会把 `base_sha` 误判为必填。
- 重复提交: 检查角色、字段与回滚列表是否有重复项。
- 中途中断: N/A，静态文档无中断状态。
- 边界值: 检查白名单第 1 项与第 9 项、三个回滚终态均未遗漏。
发现分级: P0/P1（范围外代码改动或契约误导）阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=bdaca81b5cbf78929fa3d8eeac2a24cae6113b98
DOC=docs/current/attempt-run-bridge-guide.md
SPRINT=sprints/coding-harness-20260904034439-v1423a

# 从权威实现基线到候选 HEAD 的 canonical 全仓范围，不用 workspace checkout SHA 替换 BASE_SHA。
mapfile -t CHANGED < <(git diff --name-only "$BASE_SHA...HEAD" -- . | LC_ALL=C sort)
EXPECTED=(
  "$DOC"
  "$SPRINT/contract-dod.md"
  "$SPRINT/contract-draft.md"
  "$SPRINT/task-plan.json"
  "$SPRINT/tests/attempt-run-bridge-guide.test.ts"
)
mapfile -t EXPECTED_SORTED < <(printf '%s\n' "${EXPECTED[@]}" | LC_ALL=C sort)
[ "${#CHANGED[@]}" -eq 5 ]
[ "$(printf '%s\n' "${CHANGED[@]}")" = "$(printf '%s\n' "${EXPECTED_SORTED[@]}")" ]

npx vitest run --no-cache "$SPRINT/tests/attempt-run-bridge-guide.test.ts"
node -e "const s=require('fs').readFileSync('$DOC','utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"
echo 'Golden Path 文档与全仓范围验证通过'
```

**通过阈值**: canonical `git diff --name-only bdaca81b5cbf78929fa3d8eeac2a24cae6113b98...HEAD -- .` 的闭合集合恰好为上述 5 个路径；冻结测试全绿；文档含中文。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts` | `两个端点用途与中文正文完整且拒绝漏项`；`鉴权说明完整且拒绝免鉴权误导`；`角色白名单恰好九项且拒绝增删重复`；`payload 必填恰好三项且 base_sha 可省略并保持基线`；`失败回滚恰好三个终态且不是部分成功`；`canonical 全仓 diff 仅含合同产物与唯一说明文档` | 文档尚不存在，6 个测试均失败 |
