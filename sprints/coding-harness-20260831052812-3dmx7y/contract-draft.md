# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A）

N/A — 本 Sprint 只新增使用说明文档，不改变或新增 HTTP 响应契约。

## 已知约束

- [sprint-prd.md/Invariant] Planner workspace 保持服务端签发的 planner_branch；本 Sprint 不修改该流程，N/A。
- [sprint-prd.md/Invariant] 合同硬编码角色枚举时必须与生产 SSOT 完全一致；本合同以 `packages/brain/src/routes/harness-attempt-run.js` 的 `ALLOWED_ROLES` 为证据。
- [累积FR] 本 line 暂无历史。
- context-manifest: journey_id 为 none，无可查询 line。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-bridge-guide.md` 新增中文说明，准确覆盖端点用途、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 所有标识符逐字准确；全文为简体中文；唯一产品产出文件为该文档。 |
| Invariant（永不违反） | 不修改代码、测试、API、鉴权、枚举或数据库；九角色集合与生产 SSOT 完全一致。 |
| 判定点（怎么知道） | 以仓库文件内容断言和生产 SSOT 集合比对判定。 |
| 保质期（何时过期） | 当 attempt-run 路由契约变化时，由修改该路由的变更同步更新本文档。 |
| 死亡告警（停了谁知道） | 文档契约漂移由 Sprint 冻结测试/CI 失败暴露给 PR 作者。 |
| 失败语义（挂了怎么办） | 任一必备章节、字面标识或精确集合不符即验收失败，不降级放行。 |
| 效果确认（已发≠已生效） | 从实现基线读取 SSOT，并对最终文档执行精确断言及唯一产品文件 diff 断言。 |

### 判定点登记表

（本任务无真机、RPA 或外部状态推断判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或字面契约漂移 | 测试返回非零并阻塞交付 | 是 | 无降级 |
| 角色集合少项、多项或重名 | 测试返回非零并阻塞交付 | 是 | 必须回到生产 SSOT 校正 |
| 产品文件超出范围 | git diff 断言返回非零 | 是 | 删除越界产品变更 |

### 输入对抗面

N/A — 本 Sprint 不新增或修改任何对外输入面。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块数据传递、生命周期钩子或 DB 写路径，N/A。）

## 真实调用方请求 shape

本 Sprint 不改变调用 shape；文档必须按 PRD 明确：宿主/远端请求使用 `Authorization: Bearer CECELIA_INTERNAL_TOKEN`；POST payload 必填 `sprint_dir`、`base_repo`、`branch`，`base_sha` 可省略并由生产 Brain 自解析。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

gp-anchor: skipped (product-map.json not found)

## Golden Path

独立小路（无父路）

[阅读说明] → [按鉴权发起 attempt-run] → [按 id 查询同一 run] → [判断成功或回滚终态]

### Step 1: 找到并识别两个 attempt-run 端点

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 项。

**可观测行为**: 中文文档分别说明 POST 用于异步派发 attempt，GET 用于按 id 查询该 attempt-run 的结构化结果，并明确二者属于同一流程。

**验证命令**:
```bash
DOC=docs/current/attempt-run-bridge-guide.md; test -f "$DOC" && grep -q 'POST /api/brain/harness/attempt-run' "$DOC" && grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC" && grep -q '同一' "$DOC"
```

**硬阈值**: 两个端点字面量各至少出现一次，且正文明确为同一 attempt-run 流程；上述命令 exit 0。

### Step 2: 使用正确鉴权与 payload 发起 run

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 2-4 项。

**可观测行为**: 调用方可从文档得知 loopback 与宿主/远端的边界、Bearer 令牌格式、三个必填 payload 字段和可省略的 `base_sha`。

**验证命令**:
```bash
DOC=docs/current/attempt-run-bridge-guide.md; grep -q 'internalAuthOrLoopback' "$DOC" && grep -q 'Bearer CECELIA_INTERNAL_TOKEN' "$DOC" && grep -q 'sprint_dir' "$DOC" && grep -q 'base_repo' "$DOC" && grep -q 'branch' "$DOC" && grep -qE 'base_sha.*(可省略|非必填)' "$DOC"
```

**硬阈值**: 六个契约标识全部字面命中，且 `base_sha` 明示可省略；上述命令 exit 0。

### Step 3: 从精确九角色白名单选择角色

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 3 项；角色名称取自实现基线 `packages/brain/src/routes/harness-attempt-run.js` 的 `ALLOWED_ROLES`。

**可观测行为**: 文档角色章节恰好列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，无缺项、无多项。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831052812-3dmx7y/tests/attempt-run-bridge-guide.test.ts -t '角色白名单恰为生产 SSOT 的九项精确集合'
```

**硬阈值**: 文档角色集合大小等于 9，排序去重后与生产 `ALLOWED_ROLES` 完全相等；上述测试 exit 0。

### Step 4: 判断派发失败后的三对象终态

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 4 项与「边界情况」。

**可观测行为**: 文档明确失败自动回滚同时收敛为 `run→failed`、`session→closed`、`task→cancelled`。

**验证命令**:
```bash
DOC=docs/current/attempt-run-bridge-guide.md; grep -q 'run→failed' "$DOC" && grep -q 'session→closed' "$DOC" && grep -q 'task→cancelled' "$DOC"
```

**硬阈值**: 三个对象及终态均逐字出现，缺任一项命令必须非零退出。

### Step 5: 锁定纯文档变更边界

**来源**: `[AI_ADDED]` — 将 PRD「不修改代码、测试、API 行为」转成防越界的机器断言。

**可观测行为**: 相对权威实现基线 `3c865b0f86c5f3d95bbebf6cb2d73928b565919b`，产品实现变更只有目标文档；Sprint 合同与冻结测试属于 Harness 治理产物，不计入产品实现文件集合。

**验证命令**:
```bash
BASE=3c865b0f86c5f3d95bbebf6cb2d73928b565919b; git diff --name-only "$BASE"...HEAD | grep -v '^sprints/coding-harness-20260831052812-3dmx7y/' | tee /tmp/attempt-run-product-files.txt; test "$(wc -l < /tmp/attempt-run-product-files.txt | tr -d ' ')" -eq 1 && grep -qx 'docs/current/attempt-run-bridge-guide.md' /tmp/attempt-run-product-files.txt
```

**硬阈值**: 排除本 Sprint 治理产物后恰有 1 个产品文件，且路径精确等于 `docs/current/attempt-run-bridge-guide.md`。

## 接缝清单

本单仅记录既有接口契约且不执行外部调用，无真实世界接缝，N/A。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否把 loopback 例外误写为宿主/远端免鉴权。
- 重复提交: 检查九角色是否有重复项导致表面数量为九但集合不完整。
- 中途中断: N/A（静态文档无异步流程）。
- 边界值: 检查 `generator-fix` 与 `evaluator-evidence-repair` 的连字符是否完整。
发现分级: P0/P1（错误鉴权或错误角色契约）阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web（仅在仓库工作区执行静态文档契约，不启动 UI）

```bash
#!/bin/bash
set -euo pipefail
DOC=docs/current/attempt-run-bridge-guide.md
BASE=3c865b0f86c5f3d95bbebf6cb2d73928b565919b
test -f "$DOC"
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -q 'internalAuthOrLoopback' "$DOC"
grep -q 'Bearer CECELIA_INTERNAL_TOKEN' "$DOC"
grep -q 'sprint_dir' "$DOC"
grep -q 'base_repo' "$DOC"
grep -q 'branch' "$DOC"
grep -qE 'base_sha.*(可省略|非必填)' "$DOC"
grep -q 'run→failed' "$DOC"
grep -q 'session→closed' "$DOC"
grep -q 'task→cancelled' "$DOC"
npx vitest run --no-cache sprints/coding-harness-20260831052812-3dmx7y/tests/attempt-run-bridge-guide.test.ts
git diff --name-only "$BASE"...HEAD | grep -v '^sprints/coding-harness-20260831052812-3dmx7y/' > /tmp/attempt-run-product-files.txt
test "$(wc -l < /tmp/attempt-run-product-files.txt | tr -d ' ')" -eq 1
grep -qx "$DOC" /tmp/attempt-run-product-files.txt
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 四节文档契约与范围边界 | `sprints/coding-harness-20260831052812-3dmx7y/tests/attempt-run-bridge-guide.test.ts` | `说明两个端点属于同一 attempt-run 流程`；`鉴权与 payload 字段字面准确`；`角色白名单恰为生产 SSOT 的九项精确集合`；`派发失败回滚三对象终态完整` | 目标文档尚不存在，至少 4 个测试失败 |

