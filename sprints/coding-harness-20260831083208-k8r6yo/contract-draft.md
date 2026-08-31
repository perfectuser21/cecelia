# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A）

N/A — 本 Sprint 只新增中文说明文档，不新增或修改 HTTP 端点、响应字段与数据库结构。文档描述既有端点，接口实现以 `packages/brain/src/routes/harness-attempt-run.js` 为事实来源。

## 已知约束（来自回归测试 + 累积 FR）

- [`packages/brain/src/routes/__tests__/harness-attempt-run.test.js`] → 路由同时暴露 `/attempt-run` 与 `/attempt-run/:attemptId`，角色白名单与实现导出的 `ALLOWED_ROLES` 一致。
- [`packages/brain/src/middleware/internal-auth.test.js`] → 配置内部 token 时，本机请求也必须带正确 Bearer token；未配置 token 时仅 loopback 放行、远端拒绝。
- [累积 FR] context-manifest: unavailable（本任务未提供 journey_id，无法查询对应 manifest）。
- [MAP_NOT_CONFIGURED] task bundle 未提供 map_scope/map_repo；无 must_run_assertions 可纳入。

## 锚定父路声明

独立小路（无父路）——为已存在的 attempt-run 桥接接口补充使用说明，不改变产品 Golden Path。

## Golden Path

[调用者阅读说明] → [选择允许角色并准备 payload] → [携内部凭据 POST 派发] → [用 attempt_id GET 轮询结果] → [派发失败时理解资源已自动回滚]

### Step 1: 找到两个桥接端点及正确鉴权方式
**来源**: `[FROM_PRD]` — thin PRD 第 1 项明确要求 POST/GET 用途与 `internalAuthOrLoopback` 鉴权。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 用中文说明 POST 用于异步派发单角色 attempt（202），GET 用于按 attempt id 轮询结构化结果；明确 loopback 规则，并给出宿主/远端 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN` 示例。

**验证命令**:
```bash
npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts -t "文档说明 POST 与 GET 端点用途和 internalAuthOrLoopback 鉴权" --no-cache --reporter=dot
```
**硬阈值**: 指定用例 1 passed，退出码 0；缺任一端点、鉴权名或 Bearer 示例均失败。

### Step 2: 按九项白名单选择角色
**来源**: `[FROM_PRD]` — thin PRD 第 2 项要求完整列出九项角色白名单。

**可观测行为**: 文档逐项列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，不以“等”省略。

**验证命令**:
```bash
npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts -t "文档逐项列出九个角色白名单" --no-cache --reporter=dot
```
**硬阈值**: 九个角色逐字命中且指定用例 1 passed；任一缺失即退出非 0。

### Step 3: 准备 payload 并理解 base_sha 解析
**来源**: `[FROM_PRD]` — thin PRD 第 3 项规定 `sprint_dir/base_repo/branch` 必填，`base_sha` 可省略并由生产 Brain 自解析。

**可观测行为**: 文档有独立 payload 小节与 JSON 请求示例，明确三个必填字段，并明确 `base_sha` 可省略、由生产 Brain 根据仓库/分支自行解析；不得把本角色 checkout SHA 写成实现基线。

**验证命令**:
```bash
npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts -t "文档说明 payload 三个必填字段和 base_sha 省略语义" --no-cache --reporter=dot
```
**硬阈值**: 三个字段按同一 payload 段出现，`base_sha` 省略语义与生产 Brain 自动解析语义同时命中，退出码 0。

### Step 4: 派发失败时确认桥接资源自动回滚
**来源**: `[FROM_PRD]` — thin PRD 第 4 项要求明确 `run→failed/session→closed/task→cancelled`。

**可观测行为**: 文档说明 dispatch 抛错或未返回 LAUNCHED 时，仅回滚本次新建的桥接资源，并逐项写明 run、controller session、锚 task 的终态。

**验证命令**:
```bash
npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts -t "文档说明派发失败自动回滚 run session task" --no-cache --reporter=dot
```
**硬阈值**: `run → failed`、`session → closed`、`task → cancelled` 三项逐字命中且用例 1 passed。

### Step 5: 文档变更严格限定在 docs/current
**来源**: `[AI_ADDED]` — 防止“补文档”任务夹带应用代码改动，落实 PRD 的“不改任何代码”。

**可观测行为**: Generator 最终候选相对冻结实现基线 `5c12d2af68e2b2e4b8dcaaa2c87e50efab743291` 的实现产出只有 `docs/current/attempt-run-bridge-guide.md`；Sprint 冻结合同产物除外。

**验证命令**:
```bash
bash -c 'set -o pipefail; BAD=$(git diff --name-only 5c12d2af68e2b2e4b8dcaaa2c87e50efab743291...HEAD -- . ":(exclude)sprints/coding-harness-20260831083208-k8r6yo/**" | awk '\''$0 != "docs/current/attempt-run-bridge-guide.md"'\''); [ -z "$BAD" ] || { echo "$BAD"; exit 1; }'
```
**硬阈值**: 排除冻结 Sprint 合同产物后，差异路径集合严格等于目标文档路径；出现应用代码路径即失败。

## 真实调用方请求 shape

既有调用方通过 HTTP JSON 调用 Brain：`POST /api/brain/harness/attempt-run`，`Content-Type: application/json`；宿主/远端认证 header 为 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`；请求顶层含 `role/title/payload`，payload 至少含 `sprint_dir/base_repo/branch`。本 Sprint 只记录既有 shape，不改接口。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块数据传递、生命周期钩子或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本单不改变真实接口或运行时接缝；仅以仓库现有路由与鉴权实现作为文档事实来源，N/A。）

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|---|---|---|
| **FR（做什么）** | 功能承诺 | 新增一页中文 attempt-run 桥接说明，覆盖端点、鉴权、九角色、payload 与失败回滚 |
| **NFR（做得多好）** | 可维护性 | 单页、可复制请求示例、术语与实现源码逐字一致 |
| **Invariant（永不违反）** | 范围不变量 | 不修改任何应用代码；实现基线始终为 `5c12d2af68e2b2e4b8dcaaa2c87e50efab743291` |
| **判定点（怎么知道）** | 验收 | 见下方登记表；冻结 Vitest 四项内容检查 + git diff 范围检查 |
| **保质期（何时过期）** | 退役责任 | 端点、角色或鉴权实现变化时由对应代码变更同步更新此页 |
| **死亡告警（停了谁知道）** | 漂移发现 | Sprint 冻结测试在 CI 中检查关键文案；接口实现变更评审负责同步文档 |
| **失败语义（挂了怎么办）** | 错误处理 | 缺字段/角色非法/鉴权失败按既有 HTTP 错误返回；派发失败自动回滚 |
| **效果确认（已发≠已生效）** | 真实效果 | 文档四节及示例经 Vitest 读取真实文件确认；范围经 git diff 确认 |

### 判定点登记表（对模糊现实的判断假设）

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺任一规定章节/关键事实 | 冻结测试失败，阻塞交付 | 是 | 补齐文档后重跑 |
| 派发抛错或未 LAUNCHED | 既有实现将本次新建 run/session/task 回滚到 failed/closed/cancelled | 同 run_id 的既有 run 不由本次回滚 | 返回 500/502 结构化错误，不假报成功 |

### 输入对抗面

N/A — 本 Sprint 不新增或暴露 agent/接口输入面，只记录既有接口。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否明确非法 role 会返回 `role_not_allowed`，避免读者误以为任意角色可派发
- 重复提交: 检查共享 `run_id` 的描述不会暗示每次都创建新 run
- 中途中断: 检查派发未 LAUNCHED 与抛异常两类失败都归入自动回滚说明
- 边界值: 检查 `base_sha` 缺省语义没有误写成使用当前 worker checkout SHA
发现分级: P0/P1（错误鉴权或错误基线导致远端调用失败/跨轮基线漂移）→ 阻塞 merge；P2/P3（措辞或排版）→ 记 findings 不阻塞

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
set -euo pipefail
cd /workspace
npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts --no-cache --reporter=dot
BAD=$(git diff --name-only 5c12d2af68e2b2e4b8dcaaa2c87e50efab743291...HEAD -- . ":(exclude)sprints/coding-harness-20260831083208-k8r6yo/**" | awk '$0 != "docs/current/attempt-run-bridge-guide.md"')
[ -z "$BAD" ] || { echo "FAIL: 发现范围外实现改动"; echo "$BAD"; exit 1; }
test -f docs/current/attempt-run-bridge-guide.md
echo "OK: attempt-run 桥接使用说明验收通过"
```

**通过标准**: 冻结测试 4 passed；目标中文文档存在；排除 Sprint 合同产物后，无目标文档之外的仓库改动；脚本退出码 0。

gp-anchor: skipped (product-map.json not found)

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接使用说明 | `sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts` | `文档说明 POST 与 GET 端点用途和 internalAuthOrLoopback 鉴权`、`文档逐项列出九个角色白名单`、`文档说明 payload 三个必填字段和 base_sha 省略语义`、`文档说明派发失败自动回滚 run session task` | 目标文档尚不存在，4 tests failed（ENOENT） |

> 冻结测试已落在本 Sprint 的 `tests/`，表内覆盖名均为对应 `it()` 名的字面子串。

## Notes

- contract-gate: 使用 Cecelia 仓内 `packages/brain/src/lib/contract-gate.js`，不跳过。
- implementation baseline: `5c12d2af68e2b2e4b8dcaaa2c87e50efab743291`（冻结；不以 role checkout 替换）。
