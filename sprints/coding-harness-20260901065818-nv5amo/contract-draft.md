# Sprint Contract Draft（Round 1）

## 基线与证据来源

- 实现权威基线：`perfectuser21/cecelia@5599211397c88c3827d5ce4e9c6061b3802b4fc5`（不得由角色 checkout SHA 替换）。
- PRD：planner artifact `ff314dbec53a52fcaf65cd837033ee472c273fbb` 与 task bundle `thin_prd`。
- 生产事实：`packages/brain/src/routes/harness-attempt-run.js` 的两个路由、`ALLOWED_ROLES` 与 rollback；`packages/brain/src/middleware/internal-auth.js` 的 `internalAuthOrLoopback`。
- Unified Map：`[MAP_NOT_CONFIGURED]`，task payload 未同时给出有效 `map_scope` 与 `map_repo`；因此 `must_run_assertions` 为空，不回退到领域硬编码。
- Registry：未提供可用的 API/DB/test registry 条目；本合同按 PRD 字面与实现基线生产代码起草，标记 `[NEW_PATTERN]`。
- contract-gate：使用 Cecelia 仓现有 Contract Gate；本单不修改其代码。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源：N/A）

N/A — 本任务只新增使用说明文档，不新增或修改 HTTP 响应。文档只能描述实现基线已有端点，不为其另造响应字段。

## 已知约束

- `[回归测试] packages/brain/src/routes/__tests__/harness-attempt-run.test.js`：路由必须包含 `/attempt-run` 与 `/attempt-run/:attemptId`。
- `[回归测试] packages/brain/src/middleware/internal-auth.test.js`：`internalAuthOrLoopback` 区分 loopback 与远端，并在配置 token 时严格鉴权。
- `[累积 FR]` 本 line 暂无历史。
- `[Unified Map]` 未配置，`must_run_assertions=[]`。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-bridge-guide.md` 新增一页中文说明，覆盖端点用途、鉴权、九项角色、payload 与失败回滚。 |
| NFR（做得多好） | 内容可由冻结 Vitest 逐节机械验收；只新增一页文档，不修改产品代码。 |
| Invariant（永不违反） | 不写入真实 token；不改变端点、鉴权、白名单或状态机；实现基线保持为 `5599211397c88c3827d5ce4e9c6061b3802b4fc5`。 |
| 判定点（怎么知道） | 见下方登记表；本任务无外部状态推断。 |
| 保质期（何时过期） | 当生产端点合同变化时该页需同步更新；本次内容锚定上述实现基线。 |
| 死亡告警（停了谁知道） | 冻结文档测试在 Sprint Tests/CI 失败，PR 作者与评审者可见。 |
| 失败语义（挂了怎么办） | 任一章节缺失、白名单不精确、泄露疑似真实 token 或出现产品代码改动即阻塞验收。 |
| 效果确认（已发≠已生效） | Vitest 读取实际新增文档并逐节断言，而非检查合同自身。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或事实不符 | 测试非零退出，禁止验收 | 是，修正文档后重跑 | 不允许以模糊表述降级 |
| 文档包含疑似真实 Bearer 值 | 测试非零退出，禁止提交 | 是，删除凭据后重跑 | 仅保留 `<CECELIA_INTERNAL_TOKEN>` 占位符 |
| 出现产品代码变更 | diff 验收失败 | 是，移除越界改动后重跑 | 无 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入入口。

## Golden Path

独立小路（无父路）

[读者进入说明页] → [选择创建/查询端点并正确鉴权] → [按规范角色与 payload 发起调用] → [派发失败时确认三类资源终态]

### Step 1：找到说明页并辨认两个端点

**来源**：`[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 项及「范围限定」。

**可观测行为**：`docs/current/attempt-run-bridge-guide.md` 是中文文档，明确 POST 用于创建/异步派发 attempt，GET 用于按 `:id` 查询状态/结构化结果。

**验证命令**：

```bash
npx vitest run --no-cache sprints/coding-harness-20260901065818-nv5amo/tests/attempt-run-bridge-guide.test.ts -t '说明两个端点的用途'
```

**硬阈值**：文件存在、含中文；两个端点及其不同用途全部命中。上述命令 exit code 必须为 0。

### Step 2：按正确鉴权方式调用

**来源**：`[FROM_PRD]` — PRD「Golden Path（核心场景）」第 2 项及「边界情况」。

**可观测行为**：读者看到两端点均挂 `internalAuthOrLoopback`，并且宿主/远端必须发送 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`；文档不包含真实 token。

**验证命令**：

```bash
npx vitest run --no-cache sprints/coding-harness-20260901065818-nv5amo/tests/attempt-run-bridge-guide.test.ts -t '说明鉴权且不泄露凭据'
```

**硬阈值**：鉴权中间件名、Bearer header、环境变量名、宿主/远端必须语义均存在，疑似字面 token 不存在；命令 exit code 必须为 0。

### Step 3：使用九项角色白名单

**来源**：`[FROM_PRD]` — PRD「Golden Path（核心场景）」第 3 项；具体值取实现基线 `ALLOWED_ROLES`。

**可观测行为**：文档“角色白名单”章节恰好列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge` 九项规范值。

**验证命令**：

```bash
npx vitest run --no-cache sprints/coding-harness-20260901065818-nv5amo/tests/attempt-run-bridge-guide.test.ts -t '角色白名单恰好九项'
```

**硬阈值**：列表长度严格等于 9，顺序和值与实现基线生产白名单逐项相等；命令 exit code 必须为 0。

### Step 4：区分 payload 必填与可选字段

**来源**：`[FROM_PRD]` — PRD「Golden Path（核心场景）」第 4 项。

**可观测行为**：文档把 `sprint_dir`、`base_repo`、`branch` 明确标为必填；把 `base_sha` 单独标为可省略，并说明省略后由生产 Brain 自解析。

**验证命令**：

```bash
npx vitest run --no-cache sprints/coding-harness-20260901065818-nv5amo/tests/attempt-run-bridge-guide.test.ts -t '区分 payload 必填字段和 base_sha 可选语义'
```

**硬阈值**：三个必填字段全部命中，`base_sha` 不得落入必填列表，且可省略/生产 Brain 自解析语义命中；命令 exit code 必须为 0。

### Step 5：识别派发失败自动回滚终态

**来源**：`[FROM_PRD]` — PRD「Golden Path（核心场景）」第 5 项。

**可观测行为**：文档在同一“派发失败自动回滚”章节明确 `run → failed`、`session → closed`、`task → cancelled`，说明不会留下仍运行的孤儿状态。

**验证命令**：

```bash
npx vitest run --no-cache sprints/coding-harness-20260901065818-nv5amo/tests/attempt-run-bridge-guide.test.ts -t '说明派发失败自动回滚三类终态'
```

**硬阈值**：三组映射及自动回滚/无孤儿语义全部命中；命令 exit code 必须为 0。

### Step 6：保持文档-only 边界

**来源**：`[AI_ADDED]` — 将 PRD「不改任何代码」转成不可被“文档写全但顺带改代码”绕过的可执行边界断言。

**可观测行为**：相对实现基线仅新增本 Sprint 合同产物与一页目标文档；产品代码没有变化。

**验证命令**：

```bash
bash -c 'FILES=$(git diff --name-only 5599211397c88c3827d5ce4e9c6061b3802b4fc5...HEAD); BAD=$(printf "%s\n" "$FILES" | awk '"'"'!/^(docs\/current\/attempt-run-bridge-guide\.md|sprints\/coding-harness-20260901065818-nv5amo\/)/'"'"'); [ -z "$BAD" ] || { printf "越界文件:\n%s\n" "$BAD"; exit 1; }; [ "$(printf "%s\n" "$FILES" | grep -c "^docs/current/attempt-run-bridge-guide\.md$")" -eq 1 ]'
```

**硬阈值**：目标文档恰好一页，除本 Sprint 冻结合同产物外无其他文件变化；命令 exit code 必须为 0。

## 禁 mock 边清单

（本单为纯文档改动，不触及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）测试直接读取最终文档，不 mock 文件系统。

## 真实调用方请求 shape

N/A — 本任务不新增或改变调用方；文档只描述既有端点和鉴权，不把说明示例作为新的生产请求合同。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）本 Sprint 不执行真实 attempt 派发，因为范围仅为文档且禁止改变生产行为。

## 接缝清单

（纯文档任务无真实世界接缝，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算：10 分钟 / 15 动作

高风险面：
- 错输入：检查文档是否误把 `:id` 写到 POST 参数中。
- 重复提交：N/A，文档无提交动作。
- 中途中断：N/A，文档无异步动作。
- 边界值：检查角色清单是否多一项、少一项或使用别名；检查 `base_sha` 是否误标必填。
- 发现分级：P0/P1（泄露凭据、错误鉴权或错误状态机说明）阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**：dev_pipeline
**target_environment**：local_api

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR="sprints/coding-harness-20260901065818-nv5amo"
DOC="docs/current/attempt-run-bridge-guide.md"
BASE_SHA="5599211397c88c3827d5ce4e9c6061b3802b4fc5"
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts" --reporter=verbose
FILES=$(git diff --name-only "$BASE_SHA"...HEAD)
BAD=$(printf '%s\n' "$FILES" | awk -v doc="$DOC" -v sprint="$SPRINT_DIR/" '$0 != doc && index($0, sprint) != 1')
[ -z "$BAD" ] || { printf 'FAIL: 越界文件\n%s\n' "$BAD"; exit 1; }
[ "$(printf '%s\n' "$FILES" | grep -c "^$DOC$")" -eq 1 ] || { echo 'FAIL: 目标文档不是恰好一页'; exit 1; }
echo 'OK: attempt-run 桥接使用说明文档合同验收通过'
```

**通过标准**：脚本 exit 0；冻结测试全绿；相对实现基线无产品代码变化。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接使用说明 | `sprints/coding-harness-20260901065818-nv5amo/tests/attempt-run-bridge-guide.test.ts` | `说明两个端点的用途`、`说明鉴权且不泄露凭据`、`角色白名单恰好九项`、`区分 payload 必填字段和 base_sha 可选语义`、`说明派发失败自动回滚三类终态` | 目标文档尚不存在，测试套件以 ENOENT 和 exit 1 失败 |
