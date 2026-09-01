# Sprint Contract Draft (Round 1)

## 合同基线与证据来源

- 实现基线（冻结）：`109d1df64cdc68fbec8852c3ad2d0e3291e648ef`；后续角色不得用各自 checkout 的 `workspace_spec.base_sha` 替换。
- PRD 正文：task payload 的 `thin_prd`（优先）及本目录 `sprint-prd.md`（补充）。
- 权威接口合同：`packages/brain/src/routes/harness-attempt-run.js` 的 `ALLOWED_ROLES`、路由注释与回滚 SQL；鉴权合同：`packages/brain/src/middleware/internal-auth.js`。
- Unified Map：`map_scope` 为空且 `map_repo` 未配置，记为 `[MAP_NOT_CONFIGURED]`；无 `must_run_assertions`，不做领域猜测。
- Registry：已读取 API、DB schema、test registry；本任务不定义新响应或数据库结构。
- `context-manifest: unavailable`（`journey_id=none`）。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` present)。
- gp-anchor: skipped (`product-map.json` not found)。

## Response Schema（推导来源: N/A）

N/A — 本任务只新增既有 API 的中文使用说明，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试）

- `tests/gp/f1/step3-attempt-run-endpoint.test.js` → POST 仅接受 `ALLOWED_ROLES`、派发成功返回 202、派发失败执行 run/session/task 回滚、GET 返回 attempt 投影。
- `packages/brain/src/middleware/internal-auth.test.js` → `internalAuthOrLoopback` 在 token 已配置时严格验证 token；未配置时仅非生产 loopback 放行。
- `[累积FR]` 本 line 暂无历史；context-manifest 不可用。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-bridge-guide.md` 新增中文说明，覆盖端点用途、鉴权、精确九角色闭集、payload 字段和失败回滚。 |
| NFR（做得多好） | 名称逐字准确；不展示真实凭据；唯一产品交付文件为该文档。 |
| Invariant（永不违反） | 不修改代码、配置、数据库或 API 行为；不写入 token 值。 |
| 判定点（怎么知道） | 以冻结实现基线中路由导出的 `ALLOWED_ROLES` 为角色闭集权威来源。 |
| 保质期（何时过期） | 路由、鉴权或角色闭集变化时由接口维护者同步更新本文。 |
| 死亡告警（停了谁知道） | Sprint 冻结测试及文档验收命令在缺节、漂移或越界 diff 时失败并由 CI 通知 PR 作者。 |
| 失败语义（挂了怎么办） | 任一文档断言失败即阻塞交付；不得降级为部分说明。 |
| 效果确认（已发≠已生效） | 从候选 Git 树读取文档并逐项检查正文与变更范围。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| 角色白名单的精确闭集 | A. 沿用 PRD 假设；B. 读取生产路由导出 | B. 读取 `ALLOWED_ROLES` | PRD 明示该名称需由权威接口合同校验；冻结实现是实际派发闸 | 文档指导调用方使用不存在的角色或漏掉合法角色 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或名称漂移 | 验收非零退出并阻塞交付 | 是，修正文档后重跑 | 无降级 |
| 候选含代码改动 | 验收非零退出并阻塞交付 | 是，移除越界改动后重跑 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入面。

## Golden Path

独立小路（无父路）

[读者打开说明] → [选择端点并鉴权] → [按精确角色与 payload 派发] → [查询结果或识别失败回滚]

### Step 1: 找到中文桥接说明
**来源**: `[FROM_PRD]` — thin PRD 的“在 docs/current/ 下新增一页”与验收要求。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 存在，包含中文正文和四个主题节。

**验证命令**:
```bash
node -e 'const fs=require("fs");const p="docs/current/attempt-run-bridge-guide.md";const s=fs.readFileSync(p,"utf8");if(!/[\u4e00-\u9fff]/.test(s))process.exit(1);for(const h of ["端点用途","鉴权方式","角色白名单","payload 与失败回滚"])if(!s.includes(h))process.exit(1)'
```

**硬阈值**: 文件可读、至少含一个中文字符、四个主题标题全部命中；以上命令 exit 0。

### Step 2: 按用途与鉴权规则调用两个端点
**来源**: `[FROM_PRD]` — thin PRD 第 1 项。

**可观测行为**: 文档区分 POST 派发与 GET 状态查询，并明确 `internalAuthOrLoopback`、loopback 与宿主/远端 Bearer 规则。

**验证命令**:
```bash
node -e 'const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");for(const x of ["POST /api/brain/harness/attempt-run","GET /api/brain/harness/attempt-run/:id","internalAuthOrLoopback","Bearer CECELIA_INTERNAL_TOKEN","派发","查询"])if(!s.includes(x))process.exit(1)'
```

**硬阈值**: 六个字面量全部出现；文档不得含真实 token 值；命令 exit 0。

### Step 3: 使用权威的九角色闭集与 payload
**来源**: `[FROM_PRD]` — thin PRD 第 2、3 项；角色名称按 PRD 假设要求由冻结实现校验。

**可观测行为**: 文档角色白名单恰为 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，无额外项；payload 将 `sprint_dir`、`base_repo`、`branch` 标为必填，将 `base_sha` 标为可省略且由生产 Brain 自解析。

**验证命令**:
```bash
node -e 'const fs=require("fs"),vm=require("vm");const d=fs.readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");const roles=[...d.matchAll(/^\s*[-*]\s+`([^`]+)`\s*$/gm)].map(x=>x[1]).filter(x=>!["sprint_dir","base_repo","branch","base_sha"].includes(x));const want=["canary","planner","proposer","reviewer","generator","generator-fix","evaluator","evaluator-evidence-repair","judge"];if(JSON.stringify(roles)!==JSON.stringify(want))process.exit(1);for(const x of ["`sprint_dir`（必填）","`base_repo`（必填）","`branch`（必填）","`base_sha`（可省略）","生产 Brain 自解析"])if(!d.includes(x))process.exit(1)'
```

**硬阈值**: 九角色按上述顺序精确相等（闭集，不是“至少包含”），字段标记全部命中；命令 exit 0。

### Step 4: 识别派发失败的完整回滚
**来源**: `[FROM_PRD]` — thin PRD 第 4 项。

**可观测行为**: 文档明确派发失败自动回滚为 run → `failed`、session → `closed`、task → `cancelled`。

**验证命令**:
```bash
node -e 'const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");for(const x of ["run → `failed`","session → `closed`","task → `cancelled`"])if(!s.includes(x))process.exit(1)'
```

**硬阈值**: 三对象及终态逐字命中；命令 exit 0。

### Step 5: 确认纯文档范围
**来源**: `[AI_ADDED]` — 把 thin PRD“不改任何代码”转成不可被额外代码文件绕过的候选树 oracle。

**可观测行为**: 相对冻结实现基线，排除本 sprint 合同产物后唯一变更是 `docs/current/attempt-run-bridge-guide.md`。

**验证命令**:
```bash
bash -c 'BASE=109d1df64cdc68fbec8852c3ad2d0e3291e648ef; FILES=$(git diff --name-only "$BASE"...HEAD | grep -v "^sprints/coding-harness-20260901070958-avqlef/" || :); [ "$FILES" = "docs/current/attempt-run-bridge-guide.md" ] || { printf "越界变更:\n%s\n" "$FILES"; exit 1; }'
```

**硬阈值**: 产品变更集合严格等于单一文档路径；命令 exit 0。

## 真实调用方请求 shape

N/A — 本任务不修改或执行设备/agent 到服务端的协议，仅说明冻结的既有接口。

## 禁 mock 边清单

（本单纯文档改动，不改调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本任务只校验候选 Git 树内的静态中文说明，无真机、异步或第三方接缝，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误把未知 role 或 `base_sha` 写成必填。
- 重复提交: 检查角色清单是否重复、别名是否造成闭集膨胀。
- 中途中断: N/A，静态文档无运行中状态。
- 边界值: 检查空 Bearer、loopback 与宿主/远端措辞是否会被误解为远端免鉴权。
发现分级: P0/P1（凭据泄露、远端免鉴权误导、角色闭集错误）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web（仅使用宿主工作区 Git/Node，不启动 UI）

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=109d1df64cdc68fbec8852c3ad2d0e3291e648ef
DOC=docs/current/attempt-run-bridge-guide.md
SPRINT_DIR=sprints/coding-harness-20260901070958-avqlef

node -e 'const fs=require("fs");const s=fs.readFileSync(process.argv[1],"utf8");if(!/[\u4e00-\u9fff]/.test(s))throw Error("缺中文正文");for(const x of ["POST /api/brain/harness/attempt-run","GET /api/brain/harness/attempt-run/:id","internalAuthOrLoopback","Bearer CECELIA_INTERNAL_TOKEN","`sprint_dir`（必填）","`base_repo`（必填）","`branch`（必填）","`base_sha`（可省略）","生产 Brain 自解析","run → `failed`","session → `closed`","task → `cancelled`"])if(!s.includes(x))throw Error(`缺少: ${x}`)' "$DOC"

node -e 'const fs=require("fs");const s=fs.readFileSync(process.argv[1],"utf8");const got=[...s.matchAll(/^\s*[-*]\s+`([^`]+)`\s*$/gm)].map(x=>x[1]).filter(x=>!["sprint_dir","base_repo","branch","base_sha"].includes(x));const want=["canary","planner","proposer","reviewer","generator","generator-fix","evaluator","evaluator-evidence-repair","judge"];if(JSON.stringify(got)!==JSON.stringify(want))throw Error(`角色闭集不符: ${JSON.stringify(got)}`)' "$DOC"

FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -v "^${SPRINT_DIR}/" || :)
[ "$FILES" = "$DOC" ] || { printf 'FAIL: 产品变更集合不符\n%s\n' "$FILES"; exit 1; }
git grep -nE 'Bearer [A-Za-z0-9._-]{20,}' -- "$DOC" && { echo 'FAIL: 文档疑似含真实 Bearer'; exit 1; } || :
echo 'PASS: attempt-run 桥接中文说明完整且范围合规'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 中文文档与四节 | `sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts` | `中文说明包含四个主题节` | 文档尚不存在，readFileSync 抛 ENOENT |
| 端点与鉴权 | `sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts` | `两个端点用途和远端 Bearer 鉴权` | 文档尚不存在，断言失败 |
| 九角色闭集 | `sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts` | `角色白名单严格等于权威九项闭集` | 文档尚不存在，断言失败 |
| payload 与回滚 | `sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts` | `payload 必填可选和失败回滚完整` | 文档尚不存在，断言失败 |
| 纯文档范围 | `sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts` | `唯一产品交付文件是桥接说明` | 文档尚不存在，断言失败 |

## Notes

- PRD 草案中的旧角色假设（`skeptic/reporter/controller`）与冻结实现不一致；按 PRD 自身“用权威接口合同校验名称后再固化”的要求，合同采用冻结实现导出的精确九项闭集。
- PRD A6 内嵌的旧 SHA 不作为实现基线；本合同始终使用 task bundle 冻结的 implementation baseline `109d1df64cdc68fbec8852c3ad2d0e3291e648ef`。

