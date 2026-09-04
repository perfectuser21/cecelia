# Sprint Contract Draft (Round 1)

## Notes

- implementation baseline（权威且本轮不变）: `e0a56e2efaa96a5e9b1759f6b1086282121454dd`
- PRD 验收计划中的旧 SHA 不作为实现基线；所有范围断言只使用上述冻结 SHA。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js`)
- gp-anchor: skipped (product-map.json not found)
- `[MAP_NOT_CONFIGURED]`：task bundle 未提供 map_scope/map_repo；无 must_run_assertions、fact_revisions 或 freshness 可继承。
- context-manifest: N/A（journey_id=none）

## Response Schema（推导来源: N/A）

N/A — 本任务只新增说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [`packages/brain/src/routes/__tests__/harness-attempt-run.test.js`] → 路由同时注册 `/attempt-run` 与 `/attempt-run/:attemptId`。
- [`packages/brain/src/middleware/internal-auth.test.js`] → `internalAuthOrLoopback` 区分 token 已配置、开发回环和未配置非回环。
- [累积FR] 本 line 暂无历史。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接说明，覆盖端点鉴权、九角色、payload、失败回滚。 |
| NFR（做得多好） | 精确字面量、角色封闭集合、唯一文档变更且可机械验收。 |
| Invariant（永不违反） | 不改代码；远端鉴权不描述为匿名可用；实现基线固定。 |
| 判定点（怎么知道） | 以生产 `ALLOWED_ROLES` 和路由源码为权威；见下表。 |
| 保质期（何时过期） | 当端点、鉴权、角色或 payload 契约改变时，由对应代码变更同步修订文档。 |
| 死亡告警（停了谁知道） | 冻结合同测试在 Sprint Tests 中失败并阻塞合并。 |
| 失败语义（挂了怎么办） | 任一文档断言或范围断言失败即拦截，不降级放行。 |
| 效果确认（已发≠已生效） | 从候选树读取文档并完成正向与负向 oracle；不调用生产派发。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺项或集合漂移 | 测试非零退出并阻塞合并 | 是，只读校验 | 无降级 |
| 候选范围越界 | 范围 oracle 非零退出并阻塞合并 | 是，只读校验 | 无降级 |

### 输入对抗面

N/A — 本 Sprint 不新增对外 agent 或输入入口。

## Golden Path

独立小路（无父路）

[阅读文档] → [按鉴权和白名单构造创建请求] → [查询 attempt] → [识别派发失败回滚]

### Step 1: 找到唯一中文说明文档
**来源**: `[FROM_PRD]` — “范围限定”要求仅在 `docs/current/` 新增一页中文 Markdown。

**可观测行为**: 候选相对冻结实现基线仅新增 `docs/current/attempt-run-bridge-usage.md`；排除本 Sprint 的冻结合同工件后无其他变更。

**验证命令**:
```bash
BASE_SHA=e0a56e2efaa96a5e9b1759f6b1086282121454dd; CANDIDATE_SHA="${CANDIDATE_SHA:?}"; git diff --name-status --no-renames "$BASE_SHA" "$CANDIDATE_SHA" -- . ":(exclude)sprints/coding-harness-20260904110816-exma1h/**" | tee /tmp/attempt-run-scope.txt; test "$(wc -l < /tmp/attempt-run-scope.txt | tr -d ' ')" -eq 1; grep -Fx $'A\tdocs/current/attempt-run-bridge-usage.md' /tmp/attempt-run-scope.txt
```
**硬阈值**: 封闭集合恰为一项 `A docs/current/attempt-run-bridge-usage.md`；0 项、多项、修改/重命名或非 Markdown 均失败。

### Step 2: 理解端点用途与鉴权
**来源**: `[FROM_PRD]` — Golden Path 第 1-2 项。

**可观测行为**: 文档准确解释 POST 创建派发、GET 按 id 查询、`internalAuthOrLoopback`，并明确宿主/远端必须使用 Bearer token 及回环差异。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.contract.test.ts -t "文档四节、中文、端点鉴权、九角色、payload 与回滚映射完整"
```
**硬阈值**: 指定测试 1/1 通过；任一精确字面量被替换时负向 oracle 必失败。

### Step 3: 使用封闭角色与 payload 契约
**来源**: `[FROM_PRD]` — Golden Path 第 3-4 项。

**可观测行为**: 角色先逐项列为 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，再计数为 9；payload 仅声明 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略且由生产 Brain 自解析。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.contract.test.ts -t "角色白名单恰好九项且任何缺项、多项或别名都失败"
```
**硬阈值**: 角色列表长度恰为 9 且集合精确相等；缺项、多项、别名三种负例全部被拒绝。

### Step 4: 识别完整回滚终态
**来源**: `[FROM_PRD]` — Golden Path 第 5-6 项。

**可观测行为**: 文档同时给出 `run → failed`、`session → closed`、`task → cancelled`，读者不会把部分回滚误认为完整回滚。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.contract.test.ts -t "每个正向内容 oracle 的对应负向变体都被拒绝"
```
**硬阈值**: 明示的 12 个正向内容 oracle 均有一一对应的错误替换；12 个错误变体全部抛错。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 文档描述既有接口但本 Sprint 不新增或修改调用方；精确 shape 由 PRD 字面契约冻结。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 接缝清单

（本单只验证文档内容与 Git 范围，不执行真实派发，无真实世界接缝，N/A。）

## 断言清单、计数与两两推演

封闭断言清单先列项后计数：A1 唯一新增文档；A2 中文与四节；A3 POST；A4 GET；A5 `internalAuthOrLoopback`；A6 Bearer token 与宿主/远端要求；A7 回环差异；A8 九角色精确集合；A9 三个 payload 必填字段；A10 `base_sha` 可省略及生产 Brain 自解析；A11 三个回滚映射；A12 不改代码/不越界。断言总数：12。

每个 A1-A12 都有反例：A1/A12 由 canonical diff 的空集、多项、非 A、非目标路径拒绝；A2-A11 由测试中的精确删除/替换或封闭集合突变拒绝。两两推演 66 对：任取 Ai/Aj，二者读取的证据维度分别属于 Git 范围、章节/字面量、角色集合、字段义务或回滚映射；测试不以一项成立推导另一项，且公共文档输入被独立断言。因此不存在互相矛盾、互相蕴含导致漏检或同时无法满足的断言对。自洽结论：12 项可同时由一页目标文档满足，任一项失败均不能被其他项掩盖。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 将九角色之一替换成近义别名，确认集合 oracle 拒绝。
- 重复提交: 在角色列表重复一项，确认长度与集合共同拒绝。
- 中途中断: 删除任一回滚映射，确认完整性 oracle 拒绝。
- 边界值: 新增第十角色或把 `base_sha` 错标必填，确认负向 oracle 拒绝。
发现分级: P0/P1 阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web（仅工作区 Git/文档校验，不启动 UI）

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=e0a56e2efaa96a5e9b1759f6b1086282121454dd
CANDIDATE_SHA="${CANDIDATE_SHA:?Runner must inject candidate SHA}"
SPRINT_DIR=sprints/coding-harness-20260904110816-exma1h
OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT
git diff --name-status --no-renames "$BASE_SHA" "$CANDIDATE_SHA" -- . ":(exclude)$SPRINT_DIR/**" > "$OUT"
test "$(wc -l < "$OUT" | tr -d ' ')" -eq 1
grep -Fx $'A\tdocs/current/attempt-run-bridge-usage.md' "$OUT"
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-usage.contract.test.ts"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 文档完整合同 | `sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.contract.test.ts` | `文档四节、中文、端点鉴权、九角色、payload 与回滚映射完整` / `角色白名单恰好九项且任何缺项、多项或别名都失败` / `每个正向内容 oracle 的对应负向变体都被拒绝` | 实现前目标文档不存在，首条测试失败；实现后突变负例仍证明 oracle 有辨别力 |
