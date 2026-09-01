# Sprint Contract Draft (Round 3)

## 合同基线与范围

- 权威实现基线：`perfectuser21/cecelia@5d25dcd6addb8ba30c742281b682589a3b95eaab`（来自 `inputs.implementation_baseline`；不以角色 checkout 或 PRD 中的旧 SHA 替换）。
- 实现交付严格限于新增 `docs/current/attempt-run-bridge-guide.md`；合同、DoD、冻结测试和任务计划是 Harness 治理产物，不属于实现改动。
- `[MAP_NOT_CONFIGURED]`：task payload 未提供 `map_scope`/`map_repo`，无 Unified Map 回归断言。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: N/A）

N/A — 本 Sprint 只编写既有 HTTP 接口的使用说明，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试与累积 FR）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 两个既有路由必须注册，角色白名单由 `ALLOWED_ROLES` 约束。
- `packages/brain/src/middleware/internal-auth.test.js` → loopback 例外与远端 Bearer 鉴权必须区分。
- `[累积FR]` 本 line 暂无历史。
- Unified Map `must_run_assertions`：无（未配置）。
- 仅文档改动；不得修改任何生产代码、接口、鉴权、白名单、数据库或运行行为。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文说明，覆盖端点用途、鉴权、九项角色、payload 和失败回滚。 |
| NFR（做得多好） | 内容逐字对齐权威实现基线，秘密值不得写入文档。 |
| Invariant（永不违反） | 仅新增目标文档；既有运行行为与安全边界不变。 |
| 判定点（怎么知道） | 由冻结 Vitest 对文档章节和精确字面值做机械断言。 |
| 保质期（何时过期） | 白名单、鉴权或路由实现变化时由相应代码变更同步更新本文。 |
| 死亡告警（停了谁知道） | 文档漂移由 Sprint Tests/CI 失败通知 PR 作者。 |
| 失败语义（挂了怎么办） | 任一内容断言失败即阻塞交付，不接受部分章节。 |
| 效果确认（已发≠已生效） | 测试从仓库实际目标路径读取正文并断言全部四组要求。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或内容漂移 | 测试非零退出并阻塞合并 | 是 | 无降级，修正文档后重跑 |

### 输入对抗面

N/A — 本 Sprint 不新增对外 agent 或输入面。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期或 DB 写路径，无接缝边，N/A）

## 真实调用方请求 shape

N/A — 仅记录既有端点，不修改设备/agent 调用协议；文档须按实现写明远端 `Authorization: Bearer CECELIA_INTERNAL_TOKEN`。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## Golden Path

独立小路（无父路）

[阅读说明] → [按边界理解发起与查询] → [识别允许输入] → [识别失败收口]

### Step 1: 找到中文说明与四节结构
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 项。

**可观测行为**: 中文文档位于指定路径，正文含中文，且二级标题严格且仅为「端点用途与鉴权」「角色白名单」「payload 必填字段」「派发失败自动回滚」四节。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t '中文正文与四节结构完整'`

**硬阈值**: 指定测试 1/1 通过，exit code = 0。

### Step 2: 正确理解两个端点用途与鉴权边界
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 项及「边界情况」。

**可观测行为**: 第一节分别说明 POST 发起、GET 查询，并且读者不会把 loopback 例外误解成宿主/远端免鉴权。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t '两个端点用途与鉴权规则完整'`

**硬阈值**: `internalAuthOrLoopback` 与 Bearer 要求均命中，exit code = 0。

### Step 3: 选择受支持角色
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项。

**可观测行为**: 角色章节恰好逐项列出基线实现中的九项角色，并声明白名单外不受支持。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t '角色白名单恰好列出九项固定角色'`

**硬阈值**: 九项名称及顺序完全相等，exit code = 0。

### Step 4: 构造 payload 并识别失败收口
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4、5 项。

**可观测行为**: 读者能区分三项必填字段与可省略的 `base_sha`，并识别完整失败回滚链。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t 'payload 字段与失败回滚链完整'`

**硬阈值**: 三项必填、`base_sha` 省略语义及回滚顺序全部命中，exit code = 0。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web（按冻结 PRD 路由；验收本身为仓库文档测试，无 UI 接缝）

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR='sprints/coding-harness-20260901143907-ajny7e'
BASE_SHA='5d25dcd6addb8ba30c742281b682589a3b95eaab'
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts" --reporter=verbose
ALL_CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD | sort)
IMPLEMENTATION_CHANGED=$(printf '%s\n' "$ALL_CHANGED" | grep -v "^$SPRINT_DIR/" || true)
[ "$IMPLEMENTATION_CHANGED" = 'docs/current/attempt-run-bridge-guide.md' ] || { echo "FAIL: 全仓实现变更集合不唯一: $IMPLEMENTATION_CHANGED"; exit 1; }
UNAUTHORIZED=$(printf '%s\n' "$ALL_CHANGED" | grep -v "^$SPRINT_DIR/" | grep -v '^docs/current/attempt-run-bridge-guide.md$' || true)
[ -z "$UNAUTHORIZED" ] || { echo "FAIL: 全仓存在未授权变更: $UNAUTHORIZED"; exit 1; }
echo 'OK: attempt-run 桥接使用说明合同验收通过'
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误把白名单外角色描述为可用。
- 重复提交: 检查相同术语在各章节是否前后矛盾。
- 中途中断: N/A，静态文档无异步执行。
- 边界值: 检查 `base_sha` 是否被误列入必填字段，以及远端是否被误写成免鉴权。
发现分级: P0/P1（泄露秘密或错误放宽鉴权）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts` | 中文正文与四节结构完整；两个端点用途与鉴权规则完整；角色白名单恰好列出九项固定角色；payload 字段与失败回滚链完整；全仓实现变更集合唯一 | 目标文档尚不存在，5 tests failed |

## Notes

- contract-gate: applicable (`packages/brain/src/lib/contract-gate.js` exists)
- 本合同不把当前 Proposer 的 attempt/capability UUID 固化为未来验收身份；如运行时需要身份，一律读取 Runner 注入的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID`。
