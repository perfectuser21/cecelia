# Sprint Contract Draft（Round 1）

## Response Schema（推导来源: N/A）

N/A — 本任务只新增说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → 生产路由固定包含创建与按 attempt id 查询入口。
- [packages/brain/src/middleware/internal-auth.test.js] → `internalAuthOrLoopback` 的 loopback 与 token 行为已有回归覆盖。
- [累积FR] 本 line 暂无历史。
- Unified Map: `[MAP_NOT_CONFIGURED]`（task payload 未提供可用的 map_scope/map_repo）；must_run_assertions 为空。
- context-manifest: journey_id 为 `none`，无可查询的业务线 manifest。

gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文文档，准确说明端点用途、鉴权、九项角色、payload 与失败回滚。 |
| NFR（做得多好） | 内容与生产源码逐项一致；不修改代码；不记录真实凭据。 |
| Invariant（永不违反） | 每个端点均说明鉴权；凭据不硬编码；不引入环境假设或代码行为变化。 |
| 判定点（怎么知道） | 以生产路由与鉴权中间件源码为事实源，并由冻结 Vitest 逐项核对。 |
| 保质期（何时过期） | 路由、角色或鉴权实现变化时，维护者同步更新本文档。 |
| 死亡告警（停了谁知道） | Sprint Tests 在文档缺失或事实漂移时失败并阻塞 CI。 |
| 失败语义（挂了怎么办） | 任一章节缺失、角色数量不等于九或发现疑似真实 Bearer 值即验收失败。 |
| 效果确认（已发≠已生效） | 从提交树读取文档并逐节解析，确认内容与生产常量和回滚状态一致。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或事实不符 | 测试非零退出并阻塞合并 | 是 | 无降级，修正文档后重跑 |
| 文档疑似包含真实令牌 | 测试非零退出并阻塞合并 | 是 | 删除凭据，只保留变量名示例 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入面。

## 判定点登记说明

本任务只把生产源码中的确定事实翻译为文档，不自行推断外部真实状态。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块数据传递、生命周期钩子或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 真实调用方请求 shape

N/A — 本任务不修改真实调用方或请求协议；文档只说明现有端点约束。

## Golden Path

独立小路（无父路）

[阅读说明] → [识别端点与鉴权] → [按白名单和 payload 约束接入] → [理解失败收口]

### Step 1: 找到创建与查询入口
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 项。

**可观测行为**: 文档分别解释 POST 创建 attempt-run 与 GET 按 id 查询结构化结果的用途。

**验证命令**: `npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts -t '说明创建与查询端点用途和鉴权边界'`

**硬阈值**: 两个端点字面值均存在且用途可区分；上述命令 exit 0。

### Step 2: 正确应用鉴权边界
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 项与「边界情况」。

**可观测行为**: 文档说明两端点使用 `internalAuthOrLoopback`，并明确宿主或远端必须携带 `Bearer CECELIA_INTERNAL_TOKEN`，不展示真实令牌。

**验证命令**: `npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts -t '说明创建与查询端点用途和鉴权边界'`

**硬阈值**: 四个鉴权关键字均存在且疑似真实 Bearer 值为零；上述命令 exit 0。

### Step 3: 按生产角色和 payload 约束创建
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3、4 项。

**可观测行为**: 文档独立列出九项角色，且说明 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略并由生产 Brain 自解析。

**验证命令**: `npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts -t '逐项列出生产角色白名单九项且不多不少|说明 payload 必填字段与 base_sha 省略语义'`

**硬阈值**: 角色列表与 `ALLOWED_ROLES` 九项逐位相等，四个 payload 字段语义完整；上述命令 exit 0。

### Step 4: 理解派发失败后的自动收口
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 项。

**可观测行为**: 文档同时说明 `run→failed`、`session→closed`、`task→cancelled`，不遗漏任何状态。

**验证命令**: `npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts -t '说明派发失败自动回滚的三个终态'`

**硬阈值**: 三组回滚状态全部命中；上述命令 exit 0。

### Step 5: 防止验收被非文档改动冒充
**来源**: `[AI_ADDED]` — 将 PRD「不改任何代码」转成可执行的范围闸，并锚定 authoritative implementation baseline。

**可观测行为**: 候选提交相对 `c3f8bb46d1c3108af22025fd577717f75ec1e4c1` 只允许修改 `docs/current/**` 与本 sprint 冻结合同产物。

**验证命令**: `bash -c 'BAD=$(git diff --name-only c3f8bb46d1c3108af22025fd577717f75ec1e4c1...HEAD | awk '\''! /^(docs\/current\/|sprints\/coding-harness-20260831083208-k8r6yo\/)/'\''); [ -z "$BAD" ]'`

**硬阈值**: 范围外变更文件数为 0；上述命令 exit 0。

## 接缝清单

本任务无真实世界接缝；只做提交树中文档内容和生产源码事实的静态一致性验收。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否把未知角色描述成可用角色。
- 重复提交: 检查同一字段在不同章节是否出现互相矛盾的必填说明。
- 中途中断: N/A，文档无运行时过程。
- 边界值: 检查角色列表恰为九项，回滚三态不缺项。
发现分级: P0/P1（泄露凭据或误导生产鉴权）阻塞 merge；P2/P3 记 findings 不阻塞。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
DOC="docs/current/attempt-run-bridge.md"
BASE_SHA="c3f8bb46d1c3108af22025fd577717f75ec1e4c1"
npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts --reporter=verbose
test -f "$DOC"
grep -q '^# .*attempt-run.*桥接.*说明' "$DOC"
BAD=$(git diff --name-only "$BASE_SHA"...HEAD | awk '! /^(docs\/current\/|sprints\/coding-harness-20260831083208-k8r6yo\/)/')
[ -z "$BAD" ] || { echo "FAIL: 存在范围外变更: $BAD"; exit 1; }
echo "OK: attempt-run 桥接说明文档验收通过"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 端点与鉴权 | `sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts` | 说明创建与查询端点用途和鉴权边界 | 文档不存在，readFileSync 抛出 ENOENT |
| 九项角色 | `sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts` | 逐项列出生产角色白名单九项且不多不少 | 文档不存在，测试失败 |
| payload 语义 | `sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts` | 说明 payload 必填字段与 base_sha 省略语义 | 文档不存在，测试失败 |
| 回滚三态 | `sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts` | 说明派发失败自动回滚的三个终态 | 文档不存在，测试失败 |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- authoritative implementation baseline: `c3f8bb46d1c3108af22025fd577717f75ec1e4c1`
- 本合同不固化当前 Proposer 的 attempt/capability identity；后续角色身份只接受 Runner 注入的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID`。
