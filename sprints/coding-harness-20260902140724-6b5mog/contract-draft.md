# Sprint Contract Draft (Round 1)

## Notes

- implementation baseline: `d32b864de5adf8d3083c91f31ed3f5f7f58be985`（冻结用于范围 oracle；不得替换为 checkout SHA）
- `[MAP_NOT_CONFIGURED]`：task payload 未提供可用的 `map_scope/map_repo`，无 `must_run_assertions`；禁止领域硬编码回退。
- Registry 证据：API/DB/test registry 于 2026-09-02 扫描，source revision `084ebbbc7a4213b4c2d5eb3cf01bd814b54215bf`，freshness=`fresh`；本单不改变 API/DB/test 实现。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD字面）

N/A — 本任务只新增使用说明，不修改或新增 HTTP 响应；文档中的端点语义以生产实现 `packages/brain/src/routes/harness-attempt-run.js` 为依据。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 角色白名单封闭且恰好九项；Router 同时含 `/attempt-run` 与 `/attempt-run/:attemptId`。
- `packages/brain/src/middleware/internal-auth.test.js` → `internalAuthOrLoopback` 区分 loopback 与远端鉴权。
- [累积FR] 本 line 暂无历史；`journey_id=none`，无可查询的业务 line manifest。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-bridge-guide.md` 新增中文说明，覆盖端点、鉴权、九项封闭角色、payload 和失败回滚。 |
| NFR（做得多好） | 权威术语与生产实现逐字一致；九项角色恰好九个；唯一生产交付文件。 |
| Invariant（永不违反） | 不修改代码、接口、鉴权、角色集合、数据库或共享 CI；`base_sha` 不得写成必填。 |
| 判定点（怎么知道） | 由冻结 Vitest 和 canonical git diff 范围 oracle 机械判定。 |
| 保质期（何时过期） | 生产 attempt-run 合同变化时文档过期，由该接口变更的代码所有者同步更新。 |
| 死亡告警（停了谁知道） | 文档测试在 Sprint Tests/CI 失败，PR 作者在当次 CI 内获知。 |
| 失败语义（挂了怎么办） | 缺节、角色增减、范围越界均 fail closed，禁止交付。 |
| 效果确认（已发≠已生效） | Vitest 读取真实文档内容并对冻结基线执行范围检查。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或内容漂移 | 测试非零退出，阻塞合并 | 是 | 无降级，修正文档 |
| 超出 `docs/current/` 的生产改动 | 范围 oracle 非零退出，阻塞合并 | 是 | 无降级，移除越界改动 |

### 输入对抗面

N/A — 不新增对外 Agent 或可写接口。

## Golden Path

独立小路（无父路）

[阅读说明] → [准备鉴权与角色] → [构造 POST payload] → [GET 查询并识别失败回滚]

### Step 1: 找到两个桥接端点及用途
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 项。

**可观测行为**: 中文文档分别说明 POST 用于异步派发（202）和 GET 用于按 attempt id 轮询结构化结果。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t '两个端点用途'`

**硬阈值**: 两个端点字面值均出现且用途不互换；以上命令 exit 0。

### Step 2: 按鉴权与封闭角色白名单准备请求
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 2、3 项。

**可观测行为**: 文档明确 `internalAuthOrLoopback`，宿主/远端必须使用 `Authorization: Bearer CECELIA_INTERNAL_TOKEN`，并逐项列出恰好九个生产角色。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t '鉴权与九项角色白名单'`

**硬阈值**: 白名单恰好为 `canary/planner/proposer/reviewer/generator/generator-fix/evaluator/evaluator-evidence-repair/judge`，无开放集合措辞；以上命令 exit 0。

### Step 3: 构造 POST payload
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 4 项。

**可观测行为**: 文档把 `sprint_dir`、`base_repo`、`branch` 列为必填，并说明 `base_sha` 可省略、由生产 Brain 自解析。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t 'payload 必填字段'`

**硬阈值**: 三个必填字段齐全，`base_sha` 明确非必填；以上命令 exit 0。

### Step 4: 查询结果并识别派发失败回滚
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 5 项。

**可观测行为**: 文档说明 GET 用于识别结果，并完整列出 `run→failed`、`session→closed`、`task→cancelled`。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t '派发失败自动回滚'`

**硬阈值**: 三对象终态全部存在；以上命令 exit 0。

## 真实调用方请求 shape

本单只记录使用合同，不执行或修改真实调用方。文档必须按生产中间件记录宿主/远端认证头 `Authorization: Bearer CECELIA_INTERNAL_TOKEN`，POST JSON 顶层含 `role/title/payload`，其中 payload 必填 `sprint_dir/base_repo/branch`；不得把认证字段改放 body。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 接缝清单

（本单不执行外部系统或真机接缝，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否把 `base_sha` 误写成必填。
- 重复提交: 检查九项角色是否重复、漏项或出现“等”之类开放集合措辞。
- 中途中断: N/A，静态文档无运行中状态。
- 边界值: 检查 loopback 条件是否被误解为宿主/远端免鉴权。
发现分级: P0/P1（鉴权误导、错误角色或回滚误判）阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=d32b864de5adf8d3083c91f31ed3f5f7f58be985
DOC=docs/current/attempt-run-bridge-guide.md
npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts
test -f "$DOC"
git diff --name-only "$BASE_SHA"...HEAD > /tmp/attempt-run-guide.changed
awk '!/^docs\/current\/attempt-run-bridge-guide\.md$/ && !/^sprints\/coding-harness-20260902140724-6b5mog\/(contract-draft\.md|contract-dod\.md|task-plan\.json|tests\/attempt-run-bridge-guide\.test\.ts)$/{bad=1} END{exit bad}' /tmp/attempt-run-guide.changed
test "$(grep -c '^-' "$DOC")" -ge 9
```

通过标准：脚本 exit 0；相对权威实现基线 `d32b864de5adf8d3083c91f31ed3f5f7f58be985`，生产交付仅新增 `docs/current/attempt-run-bridge-guide.md`，其余变化仅限本 sprint 冻结合同产物。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts` | 两个端点用途；鉴权与九项角色白名单；payload 必填字段；派发失败自动回滚；范围严格限于文档 | guide 文件未实现，4 tests fail、范围测试保持通过 |
