# Sprint Contract Draft (Round 1)

## Notes

- implementation baseline: `18cc9dae0611554b6f38ae0239c591449a259229`（冻结，不以本角色 checkout SHA 替换）
- Unified Map: `[MAP_NOT_CONFIGURED]`（task payload 未提供有效 map_scope/map_repo；must_run_assertions 为空）
- contract-gate: 使用 Cecelia 仓既有 `packages/brain/src/lib/contract-gate.js`
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: N/A）

N/A — 本 sprint 只新增说明文档，不新增或修改 HTTP 响应合同。文档中的端点事实逐字取自 implementation baseline 的 `packages/brain/src/routes/harness-attempt-run.js`。

## 已知约束

- [回归测试] `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 路由必须同时包含 `/attempt-run` 与 `/attempt-run/:attemptId`。
- [累积 FR] PRD 明确本 line 暂无历史。
- [Unified Map] `[MAP_NOT_CONFIGURED]`，无 must_run_assertions，不做领域硬编码回退。
- [事实来源] implementation baseline 中 `ALLOWED_ROLES` 恰为九项；POST 的派发异常或非 `LAUNCHED` 路径调用 rollback，将 run/session/task 分别收口为 failed/closed/cancelled。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接说明，覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 四节清晰；事实与冻结 implementation baseline 一致；不改代码。 |
| Invariant（永不违反） | 不硬编码 token 值；不把远端描述成免鉴权；不改变接口事实。 |
| 判定点（怎么知道） | 以 baseline 源码常量、中间件和 rollback SQL 为唯一判据。 |
| 保质期（何时过期） | 路由合同变化时由维护者同步修订文档；当前以冻结 baseline 为准。 |
| 死亡告警（停了谁知道） | N/A — 文档交付，不新增运行服务或告警。 |
| 失败语义（挂了怎么办） | 任一必备章节、角色或状态缺失即验收失败；不得部分放行。 |
| 效果确认（已发≠已生效） | Vitest 与 E2E 直接读取最终文档并核对完整内容及变更范围。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺任一事实 | 测试非零退出，阻塞交付 | 是，补正文后重跑 | 不降级、不接受部分章节 |
| baseline 与文档事实不一致 | 测试非零退出，阻塞交付 | 是，按 baseline 修订 | 不猜测、不扩写新合同 |

### 输入对抗面

N/A — 本 sprint 不新增对外 agent 或可写接口。

## 真实调用方请求 shape

本 sprint 不改变调用 shape。文档只记录 baseline 已有事实：宿主/远端请求使用 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`；POST body 包含 `role`、`title` 与 `payload`，其中 `payload.sprint_dir`、`payload.base_repo`、`payload.branch` 为本文要求列出的必填字段，`payload.base_sha` 可省略并由生产 Brain 解析。不得在文档或测试中写入 token 字面值。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A；纯文档 sprint 不派发真实 attempt。）

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块、生命周期或 DB 写路径，无接缝边，N/A。）

## 接缝清单

（本单只核验静态中文文档，不改变真实环境接缝，N/A。）

## Golden Path

独立小路（无父路）

[调用方打开说明] → [理解端点与鉴权] → [按白名单和 payload 组装请求] → [查询进度或识别失败回滚]

### Step 1: 找到中文桥接说明及两个端点用途

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 项及「预期受影响文件」。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 存在，具有端点用途章节，并分别解释 POST 创建/派发与 GET 按 id 查询。

**验证命令**:
```bash
DOC=docs/current/attempt-run-bridge-guide.md; test -f "$DOC" && grep -q '^## .*端点.*用途' "$DOC" && grep -q 'POST /api/brain/harness/attempt-run' "$DOC" && grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC" && grep -qE '创建|派发' "$DOC" && grep -qE '按.*id.*查询|查询.*id' "$DOC"
```

**硬阈值**: 文档与两个端点用途全部命中；验证命令 exit 0。

### Step 2: 区分 loopback 与宿主/远端鉴权

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 2 项及「边界情况」。

**可观测行为**: 鉴权章节写明 `internalAuthOrLoopback`，并明确宿主/远端必须携带 Bearer token，不能误读为远端免鉴权。

**验证命令**:
```bash
DOC=docs/current/attempt-run-bridge-guide.md; grep -q '^## .*鉴权' "$DOC" && grep -q 'internalAuthOrLoopback' "$DOC" && grep -q 'Bearer CECELIA_INTERNAL_TOKEN' "$DOC" && grep -qE '宿主.*远端.*必须|宿主/远端.*必须' "$DOC"
```

**硬阈值**: 中间件名、Bearer 写法和远端强制语义全部命中；验证命令 exit 0。

### Step 3: 按九角色与 payload 规则组装请求

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 3、4 项。

**可观测行为**: 角色章节逐项列出 baseline 的九个角色；payload 章节区分三个必填字段与可省略的 `base_sha`。

**验证命令**:
```bash
DOC=docs/current/attempt-run-bridge-guide.md; node -e 'const fs=require("fs");const s=fs.readFileSync(process.argv[1],"utf8");const roles=["canary","planner","proposer","reviewer","generator","generator-fix","evaluator","evaluator-evidence-repair","judge"];if(!roles.every(r=>new RegExp("`"+r+"`").test(s)))process.exit(1);if(!/九项|9 项|9项/.test(s))process.exit(1)' "$DOC" && grep -qE 'sprint_dir.*base_repo.*branch|branch.*base_repo.*sprint_dir' "$DOC" && grep -qE 'base_sha.*(可省略|选填)' "$DOC" && grep -qE '生产 Brain.*(解析|补全)' "$DOC"
```

**硬阈值**: 九个精确角色名全部出现，三字段标为必填，`base_sha` 标为可省略且由生产 Brain 解析；验证命令 exit 0。

### Step 4: 查询出口能识别派发失败自动回滚

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 5 项。

**可观测行为**: 回滚章节将三个对象及终态成组说明为 `run→failed`、`session→closed`、`task→cancelled`。

**验证命令**:
```bash
DOC=docs/current/attempt-run-bridge-guide.md; grep -q '^## .*失败.*回滚' "$DOC" && grep -qE 'run.*failed.*session.*closed.*task.*cancelled' "$DOC"
```

**硬阈值**: 三组状态按指定顺序在同一说明上下文中出现；验证命令 exit 0。

### Step 5: 防止文档交付夹带代码变更

**来源**: `[AI_ADDED]` — 将 PRD「不改任何代码」转成不可被主观解释绕过的路径 oracle。

**可观测行为**: 相对冻结 implementation baseline，排除本 sprint 冻结合同产物后，唯一实现交付文件是目标 `docs/current/attempt-run-bridge-guide.md`。

**验证命令**:
```bash
BASE=18cc9dae0611554b6f38ae0239c591449a259229; SPRINT=sprints/coding-harness-20260901020018-ofal13/; git diff --name-only "$BASE"...HEAD | awk -v sprint="$SPRINT" 'index($0,sprint)!=1{print}' | diff -u <(printf '%s\n' docs/current/attempt-run-bridge-guide.md) -
```

**硬阈值**: 过滤本 sprint 合同产物后，diff 文件集合精确等于一个目标文档；验证命令 exit 0。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查是否把 `base_sha` 误列为必填。
- 重复提交: N/A — 静态文档无提交动作。
- 中途中断: N/A — 静态文档无异步流程。
- 边界值: 检查九角色是否恰好逐项列全，特别是两个带连字符角色。
发现分级: P0/P1（错误鉴权或错误 payload 会使真实调用失败）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
DOC=docs/current/attempt-run-bridge-guide.md
BASE=18cc9dae0611554b6f38ae0239c591449a259229
SPRINT=sprints/coding-harness-20260901020018-ofal13/
test -f "$DOC"
grep -q '^# .*attempt-run.*桥接使用说明' "$DOC"
for section in '端点用途' '鉴权' '角色白名单' 'payload 字段' '派发失败自动回滚'; do grep -q "^## .*$section" "$DOC"; done
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -q 'internalAuthOrLoopback' "$DOC"
grep -q 'Bearer CECELIA_INTERNAL_TOKEN' "$DOC"
node -e 'const fs=require("fs");const s=fs.readFileSync(process.argv[1],"utf8");const roles=["canary","planner","proposer","reviewer","generator","generator-fix","evaluator","evaluator-evidence-repair","judge"];for(const r of roles){if(!s.includes("`"+r+"`"))throw Error("缺角色 "+r)}if(!/九项|9 项|9项/.test(s))throw Error("未声明九项")' "$DOC"
grep -qE 'sprint_dir.*base_repo.*branch|branch.*base_repo.*sprint_dir' "$DOC"
grep -qE 'base_sha.*(可省略|选填)' "$DOC"
grep -qE 'run.*failed.*session.*closed.*task.*cancelled' "$DOC"
git diff --name-only "$BASE"...HEAD | awk -v sprint="$SPRINT" 'index($0,sprint)!=1{print}' | diff -u <(printf '%s\n' "$DOC") -
echo 'attempt-run 桥接使用说明验收通过'
```

通过标准：脚本 exit 0；所有事实从最终文档读取；diff 范围精确匹配目标文档。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 四节内容与九角色 | `sprints/coding-harness-20260901020018-ofal13/tests/attempt-run-bridge-guide.test.ts` | 文档完整覆盖端点、鉴权、九角色、payload 与失败回滚 | 文档尚不存在，读取文件失败 |
| 纯文档变更范围 | `sprints/coding-harness-20260901020018-ofal13/tests/attempt-run-bridge-guide.test.ts` | 实现交付仅新增目标中文文档且不改代码 | 文档尚不存在，路径集合断言失败 |
