# Sprint Contract Draft (Round 1)

task_request_hash: `83916a00537fa91361e9226d897605f62da559f9c65f04cdac3badec865baf81`
implementation_baseline: `d32b864de5adf8d3083c91f31ed3f5f7f58be985`

## Response Schema（推导来源: PRD字面）

N/A — 本任务只新增说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → 角色白名单封闭，包含九个执行角色且不包含 commander/publisher。
- [packages/brain/src/middleware/internal-auth.test.js] → token 配置后必须鉴权；未配置时仅非生产 loopback 可调用。
- [累积FR] 本 line 暂无历史。
- [MAP_NOT_CONFIGURED] task payload 未提供 map_scope/map_repo；不存在 must_run_assertions、fact_revisions 或 freshness 数据。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-bridge-guide.md` 新增中文说明，准确覆盖两个端点、鉴权、九项角色、payload 与失败回滚。 |
| NFR（做得多好） | 内容与实现基线的生产 Brain 合同逐字对齐；四节均可由确定性 oracle 验证。 |
| Invariant（永不违反） | 只新增目标文档；不得修改代码、CI、接口、角色或状态；`base_sha` 不得写成必填。 |
| 判定点（怎么知道） | 无外部状态推断，N/A。 |
| 保质期（何时过期） | attempt-run 路由、鉴权、白名单或 payload 合同变更时由对应维护者同步更新。 |
| 死亡告警（停了谁知道） | 冻结 Vitest 与 E2E 内容 oracle 在 PR/CI 中失败并通知 PR 作者。 |
| 失败语义（挂了怎么办） | 任一内容或范围 oracle 失败即阻塞交付，不降级、不放行。 |
| 效果确认（已发≠已生效） | 读取提交树中的目标文档并逐项验证正文与排除项，而非仅检查文件存在。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节、角色不等于九项或字段语义错误 | oracle 非零退出并阻塞交付 | 是，修正文档后可重跑 | 无 |
| canonical 范围出现目标文档外的实现文件 | oracle 非零退出并阻塞交付 | 是，移除越界改动后可重跑 | 无 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入接口。

## Golden Path

独立小路（无父路）

[阅读说明] → [按鉴权与角色准备请求] → [POST 派发] → [GET 查询] → [识别失败回滚]

### Step 1: 找到两个桥接端点及鉴权规则
**来源**: `[FROM_PRD]` — “Golden Path（核心场景）”第 1-2 项。

**可观测行为**: 读者看到 POST 用于异步派发、GET 用于按 attempt id 轮询结构化结果；远端/宿主必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，不能把 loopback 例外扩展到远端。

**验证命令**: `node sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.oracle.cjs endpoints-auth`

**硬阈值**: 两个端点、两种用途、`internalAuthOrLoopback` 与 Bearer 规则全部命中，且不得出现“远端免鉴权”；命令 exit 0。

### Step 2: 按封闭九项角色白名单准备请求
**来源**: `[FROM_PRD]` — “Golden Path（核心场景）”第 3 项；名称取自生产路由 `ALLOWED_ROLES`。

**可观测行为**: 文档以九个独立列表项列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，并明确集合封闭。

**验证命令**: `node sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.oracle.cjs roles`

**硬阈值**: 白名单列表恰好 9 项且集合完全相等；`commander`、`publisher` 不得作为允许角色出现；命令 exit 0。

### Step 3: 构造 payload 并完成派发与查询
**来源**: `[FROM_PRD]` — “Golden Path（核心场景）”第 4 项。

**可观测行为**: 文档明确 `sprint_dir`、`base_repo`、`branch` 必填；`base_sha` 可省略并由生产 Brain 自解析，不能列为必填。

**验证命令**: `node sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.oracle.cjs payload`

**硬阈值**: 三个必填字段逐项命中；`base_sha` 省略语义命中且未进入必填列表；命令 exit 0。

### Step 4: 识别派发失败的自动回滚终态
**来源**: `[FROM_PRD]` — “Golden Path（核心场景）”第 5 项。

**可观测行为**: 文档明确同一次失败回滚产生 `run→failed`、`session→closed`、`task→cancelled` 三对象终态。

**验证命令**: `node sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.oracle.cjs rollback`

**硬阈值**: 三组对象到终态映射全部命中，缺任一组即非零退出。

### Step 5: canonical 范围保持为唯一说明文档
**来源**: `[AI_ADDED]` — 将 PRD“不改任何代码、不新增其他文档”转成基于权威 implementation baseline 的防越界 oracle。

**可观测行为**: 实现候选相对固定基线的非 sprint 合同变化只有 `docs/current/attempt-run-bridge-guide.md`。

**验证命令**: `BASE_SHA=d32b864de5adf8d3083c91f31ed3f5f7f58be985 bash -c 'ACTUAL=$(git diff --name-only "$BASE_SHA"...HEAD | grep -v "^sprints/coding-harness-20260902140724-6b5mog/" | sort); [ "$ACTUAL" = "docs/current/attempt-run-bridge-guide.md" ]'`

**硬阈值**: canonical 集合严格等于唯一目标文档；命令 exit 0。

## 真实调用方请求 shape

不适用新增接口；文档只描述既有接口。鉴权 shape 固定为请求头 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，payload 字段固定为 `sprint_dir`、`base_repo`、`branch`，可选 `base_sha`。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块、生命周期或 DB 写边，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

gp-anchor: skipped (product-map.json not found)

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web（仅使用仓库检出环境执行文档 oracle，不涉及 UI）

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR="sprints/coding-harness-20260902140724-6b5mog"
BASE_SHA="d32b864de5adf8d3083c91f31ed3f5f7f58be985"
DOC="docs/current/attempt-run-bridge-guide.md"
test -s "$DOC"
grep -q '[一-龥]' "$DOC"
for oracle in endpoints-auth roles payload rollback; do
  node "$SPRINT_DIR/tests/attempt-run-bridge-guide.oracle.cjs" "$oracle"
done
ACTUAL=$(git diff --name-only "$BASE_SHA"...HEAD | grep -v "^$SPRINT_DIR/" | sort)
[ "$ACTUAL" = "$DOC" ] || { echo "FAIL: 越界文件: $ACTUAL"; exit 1; }
echo "OK: attempt-run 桥接说明与 canonical 范围验收通过"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 桥接说明完整性与范围 | `sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts` | `两个端点与鉴权规则正负 oracle 配对`、`角色白名单恰好九项且排除非白名单角色`、`payload 必填与 base_sha 可选正负 oracle 配对`、`派发失败回滚三对象终态完整` | 目标文档尚不存在，4 tests fail |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误把 `base_sha` 写进必填集合。
- 重复提交: 检查九项角色是否重复、遗漏或夹带开放式“等”。
- 中途中断: N/A，静态文档无异步过程。
- 边界值: 检查 loopback 例外是否被误述为宿主/远端免 Bearer。
发现分级: P0/P1（错误指导调用方或隐藏不完整回滚）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- 冻结来源：task_request_hash `83916a00537fa91361e9226d897605f62da559f9c65f04cdac3badec865baf81`；implementation baseline 始终为 `d32b864de5adf8d3083c91f31ed3f5f7f58be985`，不得以角色 checkout 替换。
