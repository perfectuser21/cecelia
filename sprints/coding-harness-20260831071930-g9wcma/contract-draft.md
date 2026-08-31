# Sprint Contract Draft (Round 1)

## 合同边界与基线

- 实现基线：`5c12d2af68e2b2e4b8dcaaa2c87e50efab743291`（全过程保持不变）。
- 唯一生产产物：`docs/current/attempt-run-bridge-guide.md`。
- 禁止修改 `packages/`、`apps/`、`scripts/`、配置或其他生产代码。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- `[MAP_NOT_CONFIGURED]`：task 未提供 `map_scope/map_repo`，无 `must_run_assertions`；禁止用领域硬编码替代。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD字面）

N/A — 本任务仅新增说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [`packages/brain/src/routes/__tests__/harness-attempt-run.test.js`] → 角色白名单封闭且恰有九项，路由包含 `/attempt-run` 与 `/attempt-run/:attemptId`。
- [`packages/brain/src/middleware/internal-auth.test.js`] → `internalAuthOrLoopback` 的 loopback 与 token 行为不可被文档误述。
- context-manifest: unavailable（PRD 未提供 journey_id，无法构造 T3 请求）。
- Unified Map fact revisions/freshness: unavailable（`[MAP_NOT_CONFIGURED]`）。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增中文 attempt-run 桥接说明，覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 四个主题均有独立标题，字段与状态使用源码中的字面名称。 |
| Invariant（永不违反） | 只新增文档；不改任何生产代码；实现基线不变。 |
| 判定点（怎么知道） | 冻结 Vitest 按字面契约读取文档并断言。 |
| 保质期（何时过期） | 路由、鉴权、角色或 payload 契约变化时由对应代码变更者同步更新。 |
| 死亡告警（停了谁知道） | Sprint Tests 在文档缺失或契约漂移时立即失败并阻塞 CI。 |
| 失败语义（挂了怎么办） | 任一主题缺失或生产代码被改即阻塞交付，不降级放行。 |
| 效果确认（已发≠已生效） | 从提交树读取真实文档并通过四个冻结测试确认内容可读。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或内容不全 | Vitest 非零退出并阻塞合并 | 是；补全文档后重跑 | 无降级 |
| 生产代码相对基线变化 | E2E 非零退出并阻塞合并 | 是；移除越界改动后重跑 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入入口。

## 真实调用方请求 shape

本 Sprint 不新增调用方或请求 shape；文档必须明确宿主/远端请求使用 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，但不发起真实派发以避免创建运行资源。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 禁 mock 边清单

（本单纯文档改动，无调度、状态机、跨模块、生命周期或 DB 写路径改动，N/A）

## 接缝清单

（本单只校验提交树中的中文文档，无真实世界接缝，N/A）

## Golden Path

独立小路（无父路）

[维护者打开文档] → [理解端点与鉴权] → [选择合法角色并构造 payload] → [理解失败回滚] → [安全接入]

### Step 1: 查明桥接端点与鉴权
**来源**: `[FROM_PRD]` — thin PRD 第 1 项“两个端点的用途、鉴权方式”。

**可观测行为**: 维护者能在同一节读到 POST 派发、GET 轮询，以及宿主/远端 Bearer token 要求。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831071930-g9wcma/tests/attempt-run-bridge-guide.test.ts -t '说明 POST 与 GET 两个端点用途和 Bearer 鉴权'
```
**硬阈值**: 指定测试 1/1 通过，缺任一端点、鉴权中间件名或 Bearer 写法即非零退出。

### Step 2: 选择允许的执行角色
**来源**: `[FROM_PRD]` — thin PRD 第 2 项“角色白名单九项”。

**可观测行为**: 维护者能逐项核对九个允许角色，不会把白名单外角色交给接口。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831071930-g9wcma/tests/attempt-run-bridge-guide.test.ts -t '逐项列出九项角色白名单'
```
**硬阈值**: 九项源码字面角色全部出现，指定测试 1/1 通过。

### Step 3: 构造最小 payload
**来源**: `[FROM_PRD]` — thin PRD 第 3 项“payload 必填字段，base_sha 可省略”。

**可观测行为**: 维护者能区分 `sprint_dir/base_repo/branch` 三个必填字段与可省略的 `base_sha`，并理解省略时由生产 Brain 解析。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831071930-g9wcma/tests/attempt-run-bridge-guide.test.ts -t '说明 payload 三个必填字段与 base_sha 省略语义'
```
**硬阈值**: 三个必填字段和一项省略语义均命中，指定测试 1/1 通过。

### Step 4: 识别派发失败后的资源状态
**来源**: `[FROM_PRD]` — thin PRD 第 4 项“派发失败自动回滚”。

**可观测行为**: 维护者能明确派发失败时 run/session/task 分别进入 `failed/closed/cancelled`，不会误以为资源仍活跃。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831071930-g9wcma/tests/attempt-run-bridge-guide.test.ts -t '说明派发失败自动回滚的三项终态'
```
**硬阈值**: 自动回滚与三组资源→终态映射全部命中，指定测试 1/1 通过。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例是否误把 `base_sha` 写成必填，或遗漏 `base_repo`。
- 重复提交: 检查九角色是否重复、遗漏或被同名子串误计。
- 中途中断: N/A — 静态文档无运行中状态。
- 边界值: 检查 `generator-fix` 与 `evaluator-evidence-repair` 的连字符是否完整。
发现分级: P0/P1（错误指导远端鉴权或资源回滚）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## E2E 验收

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR='sprints/coding-harness-20260831071930-g9wcma'
BASE_SHA='5c12d2af68e2b2e4b8dcaaa2c87e50efab743291'
GUIDE='docs/current/attempt-run-bridge-guide.md'
test -f "$GUIDE"
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts"
CHANGED_CODE=$(git diff --name-only "$BASE_SHA"...HEAD -- packages apps scripts | sed '/^$/d')
[ -z "$CHANGED_CODE" ] || { echo "FAIL: 发现越界代码改动: $CHANGED_CODE"; exit 1; }
git diff --name-only "$BASE_SHA"...HEAD | grep -qx "$GUIDE"
echo 'OK: 中文说明四节完整，且未修改生产代码'
```

通过标准：脚本 exit 0；冻结测试 4/4 通过；实现基线至 HEAD 的 `packages/`、`apps/`、`scripts/` 零差异。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明四节 | `sprints/coding-harness-20260831071930-g9wcma/tests/attempt-run-bridge-guide.test.ts` | `说明 POST 与 GET 两个端点用途和 Bearer 鉴权`；`逐项列出九项角色白名单`；`说明 payload 三个必填字段与 base_sha 省略语义`；`说明派发失败自动回滚的三项终态` | 实现文档尚不存在，4 个测试均因 ENOENT 失败 |

## Notes

- 本合同只规定文档内容，不修改或重新解释现有 API 实现。
- validation identity 必须由执行角色运行时注入；本合同不固化 proposer 的 attempt 或 capability snapshot。
