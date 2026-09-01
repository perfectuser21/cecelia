# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面）

N/A — 本任务仅新增说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → 路由工厂必须挂载 `/attempt-run` 与 `/attempt-run/:attemptId`。
- [packages/brain/src/middleware/internal-auth.test.js] → `internalAuthOrLoopback` 的 loopback 与 Bearer 鉴权行为已有回归保护。
- [累积FR] 本 line 暂无历史。
- context-manifest: N/A（PRD 的 journey_id 为 none）。
- [MAP_NOT_CONFIGURED] task payload 未提供可用的 map_scope/map_repo 字符串，Unified Map 与 must_run_assertions 不适用。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文说明，准确覆盖端点、鉴权、九项角色、payload 和失败回滚。 |
| NFR（做得多好） | 四节均可由冻结 Vitest 与命令逐字核验；不修改代码。 |
| Invariant（永不违反） | 不写入真实 token；不把未鉴权远端调用描述为可用；范围只含目标文档。 |
| 判定点（怎么知道） | 文档四节的字面契约与冻结 PRD完全一致。 |
| 保质期（何时过期） | 当 attempt-run 接口契约变化时，由接口维护者同步更新本文档。 |
| 死亡告警（停了谁知道） | Sprint Tests 在文档缺失或契约漂移时立即失败。 |
| 失败语义（挂了怎么办） | 任一必需内容缺失或出现范围外文件即阻塞交付。 |
| 效果确认（已发≠已生效） | 从提交树读取文档并运行冻结测试和 E2E 内容断言。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或内容漂移 | 测试非零退出并阻塞交付 | 是 | 无降级，不接受不完整说明 |
| 修改目标文档外文件 | git 差异断言失败 | 是 | 删除范围外改动 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或可写接口。

## Golden Path

独立小路（无父路）

[阅读文档] → [确认端点与鉴权] → [选择角色] → [构造 payload] → [判断失败是否收口]

### Step 1: 找到中文说明并确认两个端点与鉴权
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1-2 项。

**可观测行为**: 文档明确 POST 用于创建并派发 attempt，GET 用于按 id 查询状态；两者采用 `internalAuthOrLoopback`，宿主或远端携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，且无真实 token。

**验证命令**: `npx vitest run sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t '文档包含两个端点用途与 Bearer 鉴权说明'`

**硬阈值**: 对应测试 1/1 通过，exit code = 0。

### Step 2: 核对角色白名单
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项。

**可观测行为**: 「角色白名单」一节恰好逐项列出 PRD 指定的九个角色，不以“等”省略。

**验证命令**: `npx vitest run sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t '角色白名单恰好列出 PRD 指定的九项角色'`

**硬阈值**: 九项按 PRD 顺序完全相等，测试 exit code = 0。

### Step 3: 按 payload 约束构造请求
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项。

**可观测行为**: 文档把 `sprint_dir`、`base_repo`、`branch` 标为必填，并说明 `base_sha` 可省略且由生产 Brain 自解析。

**验证命令**: `npx vitest run sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t 'payload 说明三个必填字段且 base_sha 可省略并由生产 Brain 自解析'`

**硬阈值**: 三个必填字段全部命中，base_sha 责任说明命中，测试 exit code = 0。

### Step 4: 判断派发失败是否完整收口
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 项。

**可观测行为**: 文档逐字给出 `run→failed`、`session→closed`、`task→cancelled` 三类终态。

**验证命令**: `npx vitest run sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t '派发失败说明 run session task 三类对象的自动回滚终态'`

**硬阈值**: 三个终态全部存在，测试 exit code = 0。

### Step 5: 确认交付范围仅含目标文档
**来源**: `[AI_ADDED]` — 将 PRD「不改任何代码」转为可执行的防越界检查。

**可观测行为**: 实现提交相对冻结实现基线只新增 `docs/current/attempt-run-bridge-guide.md`。

**验证命令**: `test "$(git diff --name-only 6496b3ba2e74f278f60fedb621127cde6c618108...HEAD -- docs packages apps | grep -v '^docs/current/attempt-run-bridge-guide\.md$' | wc -l | tr -d ' ')" = 0`

**硬阈值**: docs/packages/apps 范围内目标文档之外变更数 = 0。

## 接缝清单

（本单纯文档改动，不触及真机、第三方 API、异步状态或 DB 接缝，N/A。）

## 真实调用方请求 shape

N/A — 本任务只记录现有接口使用契约，不新增或修改调用方请求实现。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 禁 mock 边清单

（本单纯文档改动，无接缝边，N/A。）

gp-anchor: skipped (product-map.json not found)

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否错误暗示无 token 的远端请求可用。
- 重复提交: N/A，纯静态文档。
- 中途中断: N/A，纯静态文档。
- 边界值: 检查九项角色是否有遗漏、重复或“等”省略。
发现分级: P0/P1（泄露凭据或错误放行远端鉴权）阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: dev_pipeline
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=6496b3ba2e74f278f60fedb621127cde6c618108
DOC=docs/current/attempt-run-bridge-guide.md
test -f "$DOC"
npx vitest run sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts
test "$(git diff --name-only "$BASE_SHA"...HEAD -- docs packages apps | grep -v '^docs/current/attempt-run-bridge-guide\.md$' | wc -l | tr -d ' ')" = 0
! grep -Eq 'Bearer[[:space:]]+[A-Za-z0-9_-]{24,}' "$DOC"
echo 'Golden Path 文档验收通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接中文说明 | `sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts` | 文档包含两个端点用途与 Bearer 鉴权说明；角色白名单恰好列出 PRD 指定的九项角色；payload 说明三个必填字段且 base_sha 可省略并由生产 Brain 自解析；派发失败说明 run session task 三类对象的自动回滚终态 | 目标文档尚不存在，4 个测试因 ENOENT 失败 |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- implementation baseline: `6496b3ba2e74f278f60fedb621127cde6c618108`（不使用 role checkout SHA 替换）
