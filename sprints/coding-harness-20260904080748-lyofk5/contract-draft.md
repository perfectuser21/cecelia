# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面）

N/A — 本任务只新增文档，不修改或新增 HTTP 响应契约。

## 已知约束

- `[PRD Invariant]` 每个 API 端点必须有 auth；说明不得把无鉴权调用描述为成功路径。
- `[PRD Invariant]` secrets 不硬编码、不进 git、不进日志；示例只能使用 `<CECELIA_INTERNAL_TOKEN>` 占位符。
- `[PRD Invariant]` Planner 必须保持服务端签发的 planner_branch；本任务不触及 Planner 或分支逻辑。
- `[累积 FR]` 本 line 暂无历史。
- `[MAP_NOT_CONFIGURED]` task 未提供 map_scope/map_repo，因此无 must_run_assertions、fact_revisions 或 freshness 可装载。
- `[回归测试] packages/brain/src/middleware/internal-auth.test.js` → loopback 与远端鉴权分支已有覆盖，文档须忠实描述 `internalAuthOrLoopback`。
- `[回归测试] packages/brain/scripts/smoke/attempt-run-smoke.sh` → POST 派发后轮询 GET 的现有使用路径。

gp-anchor: skipped (product-map.json not found)

## Golden Path

独立小路（无父路）

[阅读说明] → [选择端点并鉴权] → [构造合法角色与 payload] → [理解派发结果或失败回滚]

### Step 1: 调用方识别两个端点及用途
**来源**: `[FROM_PRD]` — PRD“Golden Path（核心场景）”第 1 项。

**可观测行为**: 中文说明分别解释 POST 创建并派发一次角色运行，以及 GET 按 attempt id 查询状态。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260904080748-lyofk5/tests/attempt-run-bridge-doc.test.ts -t "两个端点用途与 internalAuthOrLoopback 鉴权说明完整"`

**硬阈值**: 两个端点字符串和两种用途均出现；验证命令 exit 0。

### Step 2: 调用方使用正确鉴权
**来源**: `[FROM_PRD]` — PRD“Golden Path（核心场景）”第 2 项。

**可观测行为**: 说明写明两个端点均使用 `internalAuthOrLoopback`；宿主或远端携带 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`，不展示真实令牌。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260904080748-lyofk5/tests/attempt-run-bridge-doc.test.ts -t "两个端点用途与 internalAuthOrLoopback 鉴权说明完整"`

**硬阈值**: 鉴权名、Header 占位符同时出现，疑似真实 Bearer 值为 0；验证命令 exit 0。

### Step 3: 调用方构造合法角色与 payload
**来源**: `[FROM_PRD]` — PRD“Golden Path（核心场景）”第 3、4 项。

**可观测行为**: roles 标记区间恰好列出九项生产角色；说明将 `sprint_dir`、`base_repo`、`branch` 标为必填，并说明 `base_sha` 可省略、由生产 Brain 自解析。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260904080748-lyofk5/tests/attempt-run-bridge-doc.test.ts -t "角色白名单恰好等于生产九项封闭集合|payload 必填字段与 base_sha 可省略规则完整且无反向误述"`

**硬阈值**: 角色集合严格等于九项封闭集合，两条字段测试均通过；验证命令 exit 0。

### Step 4: 调用方理解派发失败回滚
**来源**: `[FROM_PRD]` — PRD“Golden Path（核心场景）”第 5 项。

**可观测行为**: rollback 标记区间说明派发失败时 `run → failed`、`session → closed`、`task → cancelled`，不把成功或活跃状态写成失败终态。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260904080748-lyofk5/tests/attempt-run-bridge-doc.test.ts -t "派发失败回滚终态等于 run failed session closed task cancelled"`

**硬阈值**: 三个正向终态全部出现，六个反向状态均不匹配；验证命令 exit 0。

## 真实调用方请求 shape

本任务不改变真实请求 shape。文档须按生产入口写明：POST/GET 均经 `internalAuthOrLoopback`；宿主/远端 Header 为 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`；POST JSON 顶层使用 `role`，`payload` 内使用 `sprint_dir`、`base_repo`、`branch` 与可选 `base_sha`。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 接缝清单

（本单不改变真实系统接缝；说明内容由冻结测试对生产源码封闭集合进行约束，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接说明，覆盖端点、鉴权、角色、payload 与失败回滚。 |
| NFR（做得多好） | 四类内容无歧义，角色与回滚终态采用封闭集合，范围仅限一份生产文档。 |
| Invariant（永不违反） | 不弱化鉴权、不泄露令牌、不修改 Planner 分支或任何产品代码。 |
| 判定点（怎么知道） | 由冻结 Vitest 正负 oracle 与 canonical git diff 判定。 |
| 保质期（何时过期） | 生产端点、ALLOWED_ROLES、payload 或回滚契约变更时必须同步修订。 |
| 死亡告警（停了谁知道） | 冻结测试或范围 oracle 在 CI 中失败即由 PR 检查通知提交者。 |
| 失败语义（挂了怎么办） | 任一内容或范围断言失败即阻塞交付，不降级放行。 |
| 效果确认（已发≠已生效） | 以文档正文可读内容、封闭集合断言和候选 diff 为回执。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或出现反向误述 | 测试非零退出并阻塞交付 | 是 | 无降级 |
| 候选包含文档外生产变更 | canonical diff 断言失败并阻塞交付 | 是 | 无降级 |

### 输入对抗面

N/A — 本任务不新增或修改对外 Agent/API 输入面。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=22cd042f2c87358a8da4c97df9a25c09dc271082
SPRINT_DIR=sprints/coding-harness-20260904080748-lyofk5
DOC=docs/current/attempt-run-bridge.md

npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-doc.test.ts"

# canonical git-diff 范围 oracle：排除合同自身后，生产变更必须严格等于目标文档。
ACTUAL=$(git diff --name-only "$BASE_SHA" HEAD -- . ":(exclude)$SPRINT_DIR/**")
[ "$ACTUAL" = "$DOC" ] || { echo "FAIL: 越界变更: $ACTUAL"; exit 1; }

# 中文正文与凭据负向 oracle。
node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");if(!/[\u4e00-\u9fff]/.test(s)||/Bearer (?!<CECELIA_INTERNAL_TOKEN>)[A-Za-z0-9_.-]{12,}/.test(s))process.exit(1)' "$DOC"
echo "OK: attempt-run 桥接说明合同验收通过"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误称无效角色或缺字段仍可派发。
- 重复提交: N/A，文档无提交动作。
- 中途中断: N/A，文档无运行中状态。
- 边界值: 检查 Bearer 缺失/错误、角色集合之外值、缺任一必填字段的说明。
发现分级: P0/P1（泄密、弱化鉴权或错误派发契约）阻塞 merge；P2/P3 记录 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 端点与鉴权 | `sprints/coding-harness-20260904080748-lyofk5/tests/attempt-run-bridge-doc.test.ts` | 两个端点用途与 internalAuthOrLoopback 鉴权说明完整 | 文档尚不存在，readFileSync 抛 ENOENT |
| 九项角色 | `sprints/coding-harness-20260904080748-lyofk5/tests/attempt-run-bridge-doc.test.ts` | 角色白名单恰好等于生产九项封闭集合 | 文档尚不存在，readFileSync 抛 ENOENT |
| payload | `sprints/coding-harness-20260904080748-lyofk5/tests/attempt-run-bridge-doc.test.ts` | payload 必填字段与 base_sha 可省略规则完整且无反向误述 | 文档尚不存在，readFileSync 抛 ENOENT |
| 失败回滚 | `sprints/coding-harness-20260904080748-lyofk5/tests/attempt-run-bridge-doc.test.ts` | 派发失败回滚终态等于 run failed session closed task cancelled | 文档尚不存在，readFileSync 抛 ENOENT |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- 完成断言两两自洽推演：角色正向精确集合与 `reporter` 负向互补；payload 三项必填与 `base_sha` 非必填互不冲突；回滚三项正向终态与活跃/成功反向状态互斥；范围 oracle 与“不改任何代码”一致。未发现矛盾断言。
