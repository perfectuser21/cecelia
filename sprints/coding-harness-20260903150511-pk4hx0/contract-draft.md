# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面）

N/A — 本任务只新增说明文档，无 HTTP 响应或接口行为改动。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → 角色白名单封闭：包含九个执行角色，永不包含 commander/publisher
- [累积FR] 本 line 暂无历史。
- Unified Map: `[MAP_NOT_CONFIGURED]`（task payload 未提供可用的 map_scope/map_repo 字符串）；must_run_assertions 为空。
- fact_revisions/freshness: `[MAP_NOT_CONFIGURED]`，无可用地图证据。
- 实现证据：冻结实现基线 `4d5cb2fd86d97193e729a91e64efe2a44a4a0e52` 的 `packages/brain/src/routes/harness-attempt-run.js`。

gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文说明，准确说明两个端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 关键字可机械断言；不写真实 token；只新增指定文档页。 |
| Invariant（永不违反） | 不改代码；角色枚举与冻结基线一致；凭据只写变量名。 |
| 判定点（怎么知道） | 文档内容与 git diff 的封闭集合断言。 |
| 保质期（何时过期） | 服务端端点、角色或 payload 合同变化时由对应改动维护者同步更新。 |
| 死亡告警（停了谁知道） | Sprint Tests/CI 的冻结合同测试失败即通知 PR 作者。 |
| 失败语义（挂了怎么办） | 缺节、错枚举、越界文件均 fail closed，阻止合并。 |
| 效果确认（已发≠已生效） | 读取提交中的 Markdown 并验证内容与范围，不以文件存在单独判定。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或事实错误 | 测试非零退出并阻止合并 | 是 | 不降级 |
| 变更范围包含其他文件 | 范围 oracle 非零退出并阻止合并 | 是 | 不降级 |

### 输入对抗面

N/A — 不新增对外 agent 或可写接口。

## 判定点登记表

（本任务无接缝判定点，N/A）

## 真实调用方请求 shape

文档必须逐字说明：两个端点均由 `internalAuthOrLoopback` 保护；loopback 可直接调用，宿主/远端调用以 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN` 认证。文档示例不得出现 token 字面值。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 禁 mock 边清单

（本单纯文档改动，不改调度、状态机、跨模块、生命周期或 DB 写路径，N/A）

## 接缝清单

（本单只验证冻结基线上的文档事实与提交范围，无运行时真实世界接缝，N/A）

## Golden Path

独立小路（无父路）

[阅读说明] → [区分创建与查询] → [按鉴权与 payload 发起请求] → [理解合法角色与失败回滚]

### Step 1: 读者区分两个端点用途与鉴权
**来源**: `[FROM_PRD]` — thin_prd 第 1 项。

**可观测行为**: 中文文档分别列出 POST 创建/派发、GET 按 id 查询，并明确 loopback 与宿主/远端 Bearer 要求。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260903150511-pk4hx0/tests/attempt-run-bridge-guide.test.ts`

**硬阈值**: 两个端点、`internalAuthOrLoopback`、`Bearer` 与 `CECELIA_INTERNAL_TOKEN` 全部出现；缺任一项即失败。

### Step 2: 读者获得封闭的九项角色白名单
**来源**: `[FROM_PRD]` — thin_prd 第 2 项；名称逐项取自冻结基线的 `ALLOWED_ROLES`。

**可观测行为**: 文档只把 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge` 列为合法角色。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260903150511-pk4hx0/tests/attempt-run-bridge-guide.test.ts`

**硬阈值**: 合法角色集合与上述九项字面相等；少项、多项、别名或出现 `commander`/`publisher` 均失败。

### Step 3: 读者区分 payload 必填与可省略字段
**来源**: `[FROM_PRD]` — thin_prd 第 3 项。

**可观测行为**: 文档明确 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略且由生产 Brain 自解析。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260903150511-pk4hx0/tests/attempt-run-bridge-guide.test.ts`

**硬阈值**: 三个必填字段形成封闭集合；不得把 `base_sha` 写成必填。

### Step 4: 读者理解派发失败的完整自动回滚
**来源**: `[FROM_PRD]` — thin_prd 第 4 项。

**可观测行为**: 文档同时说明 `run→failed`、`session→closed`、`task→cancelled`，并称其为自动回滚。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260903150511-pk4hx0/tests/attempt-run-bridge-guide.test.ts`

**硬阈值**: 三条转换形成封闭集合，缺任一条或额外声称其他回滚终态均失败。

### Step 5: 提交范围严格限于目标文档
**来源**: `[AI_ADDED]` — 把 PRD“不改任何代码、只新增一页”的范围约束变成不可假绿的 git-diff oracle。

**可观测行为**: 除本 sprint 冻结合同产物外，基线至 HEAD 只有 `docs/current/attempt-run-bridge-guide.md`，且它是新增文件。

**验证命令**: 见 E2E 中写死冻结 `BASE_SHA` 的范围 oracle。

**硬阈值**: 交付变更集合逐字等于目标文档单元素集合，目标状态为 `A`；多文件、少文件、代码文件或修改既有文件均失败。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误称远端可以免 Bearer。
- 重复提交: 检查九角色是否重复、遗漏或混入别名。
- 中途中断: N/A，静态文档无异步过程。
- 边界值: 检查 `base_sha` 是否被误列为必填。
发现分级: P0/P1（安全误导或错误接口合同）阻塞 merge；P2/P3 记 findings 不阻塞。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA='4d5cb2fd86d97193e729a91e64efe2a44a4a0e52'
SPRINT_DIR='sprints/coding-harness-20260903150511-pk4hx0'
DOC='docs/current/attempt-run-bridge-guide.md'
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts"
CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD -- . ":(exclude)$SPRINT_DIR/**")
[ "$CHANGED" = "$DOC" ] || { echo "FAIL: 交付范围必须且只能是 $DOC，实际=$CHANGED"; exit 1; }
STATUS=$(git diff --name-status "$BASE_SHA"...HEAD -- "$DOC")
[ "$STATUS" = "A${TAB:-	}$DOC" ] || printf '%s\n' "$STATUS" | grep -qx "A[[:space:]]$DOC" || { echo "FAIL: 目标文档必须是新增文件"; exit 1; }
git diff --name-only "$BASE_SHA"...HEAD -- . ":(exclude)$SPRINT_DIR/**" | grep -Eq '^packages/|^apps/|^scripts/' && { echo 'FAIL: 禁止代码变更'; exit 1; } || true
echo 'OK: attempt-run 桥接说明及封闭范围通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260903150511-pk4hx0/tests/attempt-run-bridge-guide.test.ts` | `两个端点用途与鉴权形成正负闭环`；`九项角色白名单是封闭集合`；`payload 必填集合与 base_sha 省略语义形成正负闭环`；`派发失败回滚集合形成正负闭环` | 目标文档尚不存在，4 个测试均失败 |

## Notes

- contract-gate: 使用 Cecelia 仓代码层 Contract Gate；本合同另按 skill 内置规则自查。
- 本合同事实基线固定为 `4d5cb2fd86d97193e729a91e64efe2a44a4a0e52`，不得被角色 checkout SHA 替换。
