# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面）

N/A — 本任务只新增使用说明文档，不修改或定义 HTTP 响应。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → 角色白名单封闭：包含九个执行角色，永不包含 commander/publisher。
- [累积FR] 本 line 暂无历史。
- context-manifest: N/A（PRD 的 journey_id 为 none）。
- Unified Map: [MAP_NOT_CONFIGURED]（task payload 未提供 map_scope/map_repo）。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-bridge-guide.md` 新增中文说明，独立覆盖端点用途、鉴权、九角色与 payload、失败回滚四节。 |
| NFR（做得多好） | 标识符逐字准确；角色集合与生产 SSOT 完全一致；仅新增一份实现文档。 |
| Invariant（永不违反） | 不改代码/API；不把远端写成免鉴权；不把 `base_sha` 写成必填；不改变九角色集合。 |
| 判定点（怎么知道） | 以 `ALLOWED_ROLES`、路由和中间件源码为生产 SSOT，机器解析并比对文档。 |
| 保质期（何时过期） | 路由、鉴权、角色或 payload 契约变化时由对应代码变更同步更新本文档。 |
| 死亡告警（停了谁知道） | 冻结测试与 E2E 在文档缺失或漂移时非零退出，CI/验收任务可见。 |
| 失败语义（挂了怎么办） | 任一节或精确集合断言失败即阻塞交付，不降级放行。 |
| 效果确认（已发≠已生效） | 从实现基线读取文档并对四节逐项断言，另将角色列表与源码导出集合精确比对。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节、标识漂移或角色集合不等 | 验收命令非零退出并阻塞交付 | 是（只读检查） | 无 |
| 无法读取生产 SSOT | 验收命令非零退出 | 是 | 禁止凭记忆补集合 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入入口。

## 判定点登记表补充说明

本任务唯一判定依据是仓库内生产源码，不涉及模糊外部状态；无需用户拍板项。

## Golden Path

独立小路（无父路）

[阅读说明] → [理解创建与查询] → [按远端鉴权] → [提交九角色之一与必填 payload] → [判断派发失败回滚]

### Step 1: 从两个端点理解同一 attempt-run 流程

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 项及边界情况明确要求分别说明创建、查询且不得混成独立 run。

**可观测行为**: 文档“端点用途”节同时给出 POST 异步派发与 GET 按 POST 返回的 `attempt_id` 查询同一流程。

**验证命令**: `node sprints/coding-harness-20260831052812-3dmx7y/tests/verify-attempt-run-guide.mjs endpoints`

**硬阈值**: 两个端点字面值各出现且同节明确 `attempt_id` 串联；命令 exit 0。

### Step 2: 宿主或远端按内部鉴权调用

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 项和边界情况要求 `internalAuthOrLoopback`，且宿主/远端必须携带 Bearer token。

**可观测行为**: 文档“鉴权方式”节不会把 loopback 条件误写为宿主/远端免鉴权。

**验证命令**: `node sprints/coding-harness-20260831052812-3dmx7y/tests/verify-attempt-run-guide.mjs auth`

**硬阈值**: 同节含 `internalAuthOrLoopback`、`Authorization: Bearer CECELIA_INTERNAL_TOKEN` 及宿主/远端“必须”语义；命令 exit 0。

### Step 3: 选择九项角色并提交 payload

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3、4 项要求生产九项白名单、三个必填字段和可省略的 `base_sha`。

**可观测行为**: 文档“角色白名单与 payload”节列出的角色与 `ALLOWED_ROLES` 恰好同一集合；明确 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略并由生产 Brain 自解析。

**验证命令**: `node sprints/coding-harness-20260831052812-3dmx7y/tests/verify-attempt-run-guide.mjs roles-payload`

**硬阈值**: 文档角色恰好 9 项且与生产 SSOT 精确集合相等，字段义务无反转；命令 exit 0。

### Step 4: 派发失败时识别自动回滚结果

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项要求同时说明 run、session、task 三类对象终态。

**可观测行为**: 文档“派发失败自动回滚”节明确 `run→failed`、`session→closed`、`task→cancelled`，不存在只描述部分对象的情况。

**验证命令**: `node sprints/coding-harness-20260831052812-3dmx7y/tests/verify-attempt-run-guide.mjs rollback`

**硬阈值**: 三个状态对全部逐字出现；命令 exit 0。

## 真实调用方请求 shape

本任务不新增或修改调用方。文档只记录 PRD 冻结的生产调用 shape：宿主/远端使用 `Authorization: Bearer CECELIA_INTERNAL_TOKEN`；POST JSON 的业务字段包括 `role` 与 `payload`，其中 `payload.sprint_dir`、`payload.base_repo`、`payload.branch` 必填，`payload.base_sha` 可省略。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期或 DB 写路径，N/A。）

## 接缝清单

（本任务只核验仓库内文档与生产源码 SSOT，无真实世界接缝，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 已知回归约束

- INV-1 规划分支：本合同只在 Brain 签发的 proposer 分支产出，不要求 Provider 切换 planner 分支。
- INV-2 合同枚举：角色断言从 `packages/brain/src/routes/harness-attempt-run.js` 的 `ALLOWED_ROLES` 解析并做精确集合比较，防止漏项。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## Notes

- implementation baseline: `98bc3594876bcf53b428d4b1256d9c1e695494c2`（全过程保持不变）。
- contract-gate: applicable (`packages/brain/src/lib/contract-gate.js` exists)。
- 实现边界：唯一生产产物为 `docs/current/attempt-run-bridge-guide.md`；合同、DoD、冻结测试和 task plan 是 Harness 治理产物。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR=sprints/coding-harness-20260831052812-3dmx7y
DOC=docs/current/attempt-run-bridge-guide.md
BASE_SHA=98bc3594876bcf53b428d4b1256d9c1e695494c2
test -f "$DOC"
node "$SPRINT_DIR/tests/verify-attempt-run-guide.mjs" all
CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD | awk -v prefix="$SPRINT_DIR/" 'index($0,prefix)!=1')
test "$CHANGED" = "$DOC"
test "$(printf '%s\n' "$CHANGED" | sed '/^$/d' | wc -l | tr -d ' ')" -eq 1
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误把 `base_sha` 列入必填字段。
- 重复提交: 检查九角色列表是否有重复项造成“九行但非九项集合”。
- 中途中断: N/A（静态文档）。
- 边界值: 检查 `generator-fix`、`evaluator-evidence-repair` 等连字符名称是否逐字准确。
发现分级: P0/P1（鉴权误导、角色或回滚契约错误）阻塞 merge；P2/P3 记 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 四节说明与九角色精确集合 | `sprints/coding-harness-20260831052812-3dmx7y/tests/attempt-run-bridge-guide.test.ts` | 端点用途节串联同一 attempt-run；鉴权方式节要求远端 Bearer；角色与 payload 节匹配九角色精确集合；失败回滚节包含三个终态 | 文档尚不存在时 4 个 `it()` 均失败 |
