# Sprint Contract Draft (Round 1)

task_request_hash=1838c4d9069d5b08f980716d3d248df5f1cd7a8d03b585d3c89b8195798071dc

## Response Schema（推导来源: N/A）

N/A — 本任务只新增说明文档，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试与累积 FR）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → `ALLOWED_ROLES` 恰好九项且为冻结集合。
- `tests/gp/f1/step3-attempt-run-endpoint.test.js` → 派发未 LAUNCHED 时回滚 run、session 与 task 锚。
- [累积FR] 本 line 暂无历史。
- Unified Map: `[MAP_NOT_CONFIGURED]`（task payload 未提供可用的 map_scope/map_repo）。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-桥接使用说明.md` 新增中文说明，覆盖两个端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 九角色采用封闭集合；示例不含真实凭据；读者仅凭本文可构造请求并解释结果。 |
| Invariant（永不违反） | 不改产品代码、路由、鉴权、白名单、状态机、配置或既有文档。 |
| 判定点（怎么知道） | 由冻结测试对文档章节、封闭集合、正负 oracle 与范围 diff 机检。 |
| 保质期（何时过期） | 端点合同变化时由对应代码维护者同步更新本文；本 sprint 不定义时间型过期。 |
| 死亡告警（停了谁知道） | Sprint Tests/合同验收在内容漂移或文档缺失时立即失败。 |
| 失败语义（挂了怎么办） | 任一内容或范围断言失败即阻塞交付，不放行。 |
| 效果确认（已发≠已生效） | 冻结 Vitest 读取提交树中的真实文档，并与生产 `ALLOWED_ROLES` 比较。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节、枚举漂移或范围越界 | 测试非零退出并阻塞交付 | 是 | 无降级，不接受部分文档 |

### 输入对抗面

N/A — 不新增对外 agent 或输入接口。

## Golden Path

独立小路（无父路）

[阅读说明] → [正确鉴权并构造 POST] → [按 attempt id 查询] → [解释成功或完整失败回滚]

### Step 1: 识别桥接端点与鉴权
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1-2 项。

**可观测行为**: 文档明确 POST 用于创建并派发 attempt，GET 用于按 id 查询；两者使用 `internalAuthOrLoopback`，宿主/远端使用 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`。

**验证命令**: `npx vitest run sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t '端点用途与鉴权说明完整'`

**硬阈值**: 两个端点、鉴权中间件、Bearer header 与占位 token 全部命中，真实 token 形态零命中。

### Step 2: 选择合法角色
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项。

**可观测行为**: 文档独立列出且仅列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，并说明集合外角色被拒绝。

**验证命令**: `npx vitest run sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t '角色白名单是恰好九项的封闭集合'`

**硬阈值**: 文档集合与生产 `ALLOWED_ROLES` 集合相等、长度等于 9，且 `commander`/`publisher` 不得成为白名单项。

### Step 3: 构造合法 payload
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项。

**可观测行为**: 文档将 `sprint_dir`、`base_repo`、`branch` 标成必填；将 `base_sha` 标成可省略，并明确省略时由生产 Brain 自解析。

**验证命令**: `npx vitest run sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t 'payload 必填与可省略字段无歧义'`

**硬阈值**: 三项必填全部出现；`base_sha` 不得归入必填集合，且必须同时出现“可省略”和“生产 Brain 自解析”。

### Step 4: 查询并解释派发失败
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5-6 项。

**可观测行为**: 文档说明通过 GET 查询结果，并将派发失败完整解释为 `run → failed`、`session → closed`、`task → cancelled`，不描述成半成功。

**验证命令**: `npx vitest run sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t '派发失败完整回滚且不是半成功'`

**硬阈值**: 三个状态映射逐字命中且文档明确“不是半成功”。

### Step 5: 保持文档唯一产品变更
**来源**: `[AI_ADDED]` — 将 PRD 的“不改任何代码”范围约束转换为不可绕过的冻结基线 diff oracle。

**可观测行为**: 相对实现基线仅允许目标说明文档和本 sprint 合同产物发生变化。

**验证命令**: `BASE_SHA=6230da4a13fad9e43d6316b70914b5b69033ef37; git diff --name-only "$BASE_SHA"...HEAD | awk '!/^docs\/current\/attempt-run-桥接使用说明\.md$/ && !/^sprints\/coding-harness-20260903005419-evol42\//' | (! read -r unexpected)`

**硬阈值**: canonical `git diff --name-only "$BASE_SHA"...HEAD` 输出中，允许集合之外路径数为 0；BASE_SHA 固定为实现基线 `6230da4a13fad9e43d6316b70914b5b69033ef37`。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块、生命周期或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 本 sprint 只记录既有接口，不发起真实派发；文档示例须使用 `Authorization` header 和 `payload` 字段的生产同形结构。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A；PRD 明确不验证真实派发副作用。）

gp-anchor: skipped (product-map.json not found)

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 核查文档是否错误暗示无 Bearer 的远端请求可成功。
- 重复提交: N/A，文档任务不执行提交。
- 中途中断: N/A，文档读取无异步过程。
- 边界值: 核查九角色是否出现“等”或额外白名单项，及 `base_sha` 是否被误列必填。
发现分级: P0/P1 → 阻塞 merge；P2/P3 → 记录 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=6230da4a13fad9e43d6316b70914b5b69033ef37
TEST_FILE=sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts
npx vitest run "$TEST_FILE" --reporter=verbose
UNEXPECTED=$(git diff --name-only "$BASE_SHA"...HEAD | awk '!/^docs\/current\/attempt-run-桥接使用说明\.md$/ && !/^sprints\/coding-harness-20260903005419-evol42\//')
[ -z "$UNEXPECTED" ] || { echo "FAIL: 范围外改动: $UNEXPECTED"; exit 1; }
test -z "$(git diff --name-only "$BASE_SHA"...HEAD -- packages apps scripts .github)"
echo 'OK: 中文桥接说明及冻结范围验收通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 中文说明 | `sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts` | `端点用途与鉴权说明完整`；`角色白名单是恰好九项的封闭集合`；`payload 必填与可省略字段无歧义`；`派发失败完整回滚且不是半成功` | 目标文档尚不存在，至少 4 个测试失败 |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` present)
- 本合同只授权新增 `docs/current/attempt-run-桥接使用说明.md`，不得修改产品代码或既有文档。
