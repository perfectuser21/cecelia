# Sprint Contract Draft (Round 1)

task_request_hash: 1838c4d9069d5b08f980716d3d248df5f1cd7a8d03b585d3c89b8195798071dc

## Response Schema（推导来源: N/A）

N/A — 本任务仅新增使用说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → 路由同时注册 `/attempt-run` 与 `/attempt-run/:attemptId`。
- [packages/brain/src/middleware/internal-auth.test.js] → `internalAuthOrLoopback` 对 loopback 与 Bearer token 执行既有鉴权策略。
- [累积FR] 本 line 暂无历史。
- Unified Map: `[MAP_NOT_CONFIGURED]`（task payload 未给出可用的 map_scope/map_repo）。
- implementation baseline: `6230da4a13fad9e43d6316b70914b5b69033ef37`，范围比较不得替换为角色 checkout SHA。

gp-anchor: skipped (product-map.json not found)

## Golden Path

独立小路（无父路）

[阅读说明] → [按规则构造 POST] → [按 attempt_id 查询] → [辨识成功或完整失败回滚]

### Step 1: 读者识别两个桥接端点与鉴权方式

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1-2 项。

**可观测行为**: 新文档明确 POST 用于创建并派发一次 attempt，GET 用于按标识查询；两者采用 `internalAuthOrLoopback`，宿主/远端请求示例使用 `Authorization: Bearer ${CECELIA_INTERNAL_TOKEN}` 占位而不含真实凭据。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts
```

**硬阈值**: 两个端点、鉴权策略名及 Bearer 环境变量引用全部命中，且禁止出现 32 字节以上疑似明文 token；以上测试 exit 0。

### Step 2: 读者从封闭九项角色集合选择合法角色

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 3 项；角色字面值取自生产 `ALLOWED_ROLES`。

**可观测行为**: “角色白名单”独立章节恰好列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，并明确集合外角色会被拒绝。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts
```

**硬阈值**: 实际集合与上述封闭集合完全相等，数量恰好 9；额外项、缺项以及“等”式开放枚举均令测试失败。

### Step 3: 读者构造合法 payload 并理解 base_sha 省略语义

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 4、6 项。

**可观测行为**: 文档将 `sprint_dir`、`base_repo`、`branch` 标为必填，将 `base_sha` 标为可省略；省略时由生产 Brain 自解析。请求示例可直接照抄并仅需注入环境 token。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts
```

**硬阈值**: 三个必填字段全部出现且无第四个字段被称为必填；`base_sha` 同时出现“可省略”和“生产 Brain 自解析”语义，反向禁止“调用方猜测/自行解析”。

### Step 4: 读者查询 attempt 并辨识派发失败的完整收口

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 5-6 项。

**可观测行为**: GET 示例使用 POST 返回的 `attempt_id`；派发失败章节逐字包含 `run → failed`、`session → closed`、`task → cancelled`，并说明可由 GET 辨识失败终态。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts
```

**硬阈值**: 三种资源状态形成封闭且完整的三项映射；任一遗漏或额外终态映射均失败。

## 接缝清单

（本任务仅冻结既有生产接口的中文说明，不验证真实派发副作用；无待真目标验证接缝，N/A。）

## 禁 mock 边清单

（本单纯文档改动，不改调度、状态机、跨模块数据、生命周期或 DB 写路径，N/A。）

## 真实调用方请求 shape

不适用新增调用方协议；文档只描述既有 shape：宿主/远端认证头为 `Authorization: Bearer ${CECELIA_INTERNAL_TOKEN}`，POST JSON 顶层含 `role`，其 `payload` 对象含 `sprint_dir`、`base_repo`、`branch`，可选 `base_sha`。

## 未覆盖真实链路清单

（本合同无 mock 豁免；PRD 明确排除真实派发副作用验证，N/A。）

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接说明，覆盖端点、鉴权、角色、payload 与失败回滚。 |
| NFR（做得多好） | 角色与回滚均为封闭集合；示例无真实凭据。 |
| Invariant（永不违反） | 不改产品代码；不泄露 token；不改变既有接口语义。 |
| 判定点（怎么知道） | 由冻结 Vitest 合同逐字及集合相等断言。 |
| 保质期（何时过期） | 端点、鉴权、角色或状态合同变化时该页须同步更新。 |
| 死亡告警（停了谁知道） | 文档合同测试在 Sprint Tests 中失败并阻塞合并。 |
| 失败语义（挂了怎么办） | 任一缺项、增项、凭据泄露或范围越界均 fail closed。 |
| 效果确认（已发≠已生效） | 仅以提交树中文档内容及冻结测试为验收对象，不声称真实派发已执行。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺项或枚举漂移 | 测试非零退出并阻塞合并 | 是 | 无降级，修正文档 |
| 发现疑似真实 token | 测试非零退出并阻塞合并 | 是 | 删除凭据并轮换已暴露凭据 |
| 改动范围越界 | 测试非零退出并阻塞合并 | 是 | 移除越界改动 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或可写接口。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否错误暗示无 token 的远端请求可成功。
- 重复提交: N/A，文档无写操作。
- 中途中断: N/A，文档无运行流程。
- 边界值: 检查角色清单第 1、9 项及带连字符角色未被拆分。
发现分级: P0/P1（凭据泄露或错误授权说明）阻塞 merge；P2/P3 记 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA="6230da4a13fad9e43d6316b70914b5b69033ef37"
SPRINT_DIR="sprints/coding-harness-20260903005419-evol42"
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-doc-contract.test.ts"
CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD)
printf '%s\n' "$CHANGED" | grep -qx 'docs/current/attempt-run-桥接使用说明.md'
if printf '%s\n' "$CHANGED" | grep -Ev '^(docs/current/attempt-run-桥接使用说明\.md|sprints/coding-harness-20260903005419-evol42/(contract-draft\.md|contract-dod\.md|task-plan\.json|tests/attempt-run-doc-contract\.test\.ts))$' | grep -q .; then
  echo "FAIL: 改动超出冻结范围"; exit 1
fi
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 中文说明完整性与范围 | `sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts` | `文档完整描述 attempt-run 桥接合同`、`角色白名单是恰好九项的封闭集合`、`payload 必填集合与 base_sha 可选语义准确`、`派发失败回滚是封闭三项映射`、`变更范围仅允许目标文档和本 sprint 合同产物` | 目标文档尚不存在，至少 4 个测试失败 |

## Notes

- contract-gate: 使用 Cecelia 仓内代码层 Contract Gate；本合同不改其实现。
- canonical scope oracle 固定以 implementation baseline `6230da4a13fad9e43d6316b70914b5b69033ef37...HEAD` 执行 `git diff --name-only`，不得改用 workspace checkout base。
