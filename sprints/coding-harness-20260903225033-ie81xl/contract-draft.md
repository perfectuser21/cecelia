# Sprint Contract Draft (Round 1)

## 合同依据与范围

- 实现基线（冻结用于全部范围断言）：`f277cc41ebc2ae7c4669f1c77e487663be2680e6`。
- 唯一产品产物：`docs/current/attempt-run-bridge-guide.md`；不得修改代码或新增其他文档页。
- Unified Map：`[MAP_NOT_CONFIGURED]`（task payload 未提供可用的 map_scope/map_repo）；无 `must_run_assertions`。
- 已知约束：[累积 FR] 无；[回归测试] `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` 锁定九项角色白名单及两个路由。
- Response Schema：N/A — 本任务只新增说明文档，不改变或定义 HTTP 响应。
- gp-anchor：skipped (product-map.json not found)；PRD 已指定 `none(docs)`。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文说明，覆盖端点与鉴权、九项角色、payload、失败回滚四节。 |
| NFR（做得多好） | 四节独立、枚举无省略、机械可验；其余性能类 NFR 不适用于静态文档。 |
| Invariant（永不违反） | 不写真实 token，不改鉴权/代码，`base_sha` 不描述为必填。 |
| 判定点（怎么知道） | 由固定字符串、精确枚举及基线 diff 断言判定。 |
| 保质期（何时过期） | 当端点、白名单或 payload 契约变化时，由对应代码变更同步更新。 |
| 死亡告警（停了谁知道） | 冻结 Vitest 与合同 oracle 在 CI 失败并阻塞合并。 |
| 失败语义（挂了怎么办） | 任一文档或范围断言失败即阻塞；不放行、不降级。 |
| 效果确认（已发≠已生效） | 检查最终提交中的唯一产品文件及其四节内容，不以命令回显代替。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节、枚举错误或越界改动 | oracle 非零退出并阻塞 | 是 | 无降级 |

### 输入对抗面

N/A — 不新增对外 agent 或可写接口。

## Golden Path

独立小路（无父路）

阅读说明 → 正确鉴权并理解 POST/GET 用途 → 选择九项允许角色之一并构造 payload → 查询状态并识别派发失败回滚。

### Step 1: 识别端点用途与鉴权
**来源**: `[FROM_PRD]` — “Golden Path（核心场景）”第 1-2 项。

**可观测行为**: 中文章节分别说明 POST 派发、GET 按 id 查询；说明 `internalAuthOrLoopback`，并要求宿主/远端携带 Bearer `CECELIA_INTERNAL_TOKEN`，不展示真实 token。

**验证命令**: `node sprints/coding-harness-20260903225033-ie81xl/tests/contract-oracles.mjs endpoint-auth`

**硬阈值**: 两个端点、鉴权中间件名和 Bearer 环境变量名各精确出现；负向断言拒绝真实 token 样式或“远端无需鉴权”。

### Step 2: 按封闭白名单选择角色
**来源**: `[FROM_PRD]` — “Golden Path（核心场景）”第 3 项；名称来自服务端 `ALLOWED_ROLES`。

**可观测行为**: 先逐项列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，随后声明“角色白名单恰好 9 项”。

**验证命令**: `node sprints/coding-harness-20260903225033-ie81xl/tests/contract-oracles.mjs roles`

**硬阈值**: 上述九项各一次且总数恰好 9；负向断言拒绝 `commander`、`publisher` 和“等”式省略。

### Step 3: 构造 payload
**来源**: `[FROM_PRD]` — “Golden Path（核心场景）”第 4 项。

**可观测行为**: 先逐项列出 `sprint_dir`、`base_repo`、`branch`，随后声明“payload 必填字段恰好 3 项”；另述 `base_sha` 可省略并由生产 Brain 自解析。

**验证命令**: `node sprints/coding-harness-20260903225033-ie81xl/tests/contract-oracles.mjs payload`

**硬阈值**: 三个必填字段逐项存在且恰好 3 项；负向断言拒绝把 `base_sha` 列入必填或写成调用方必须解析。

### Step 4: 判读派发失败回滚
**来源**: `[FROM_PRD]` — “Golden Path（核心场景）”第 5-6 项。

**可观测行为**: 独立章节逐项说明 `run→failed`、`session→closed`、`task→cancelled`，随后声明“自动回滚结果恰好 3 项”，且无需调用方修补状态。

**验证命令**: `node sprints/coding-harness-20260903225033-ie81xl/tests/contract-oracles.mjs rollback`

**硬阈值**: 三条转换逐项存在且恰好 3 项；负向断言拒绝“调用方需手工修补/回滚”。

## 断言两两自洽推演

总计 10 个 oracle：四组内容正向 P1-P4、四组对应负向 N1-N4、中文 P5、范围 N5。逐对结论：P1/N1 同时要求正确鉴权且禁止绕过；P2/N2 同时封闭九项角色且排除额外角色/省略；P3/N3 同时固定三项必填且排除 `base_sha` 必填；P4/N4 同时固定三项回滚且排除人工修补；P5/N5 同时要求中文产物且只允许目标文档。各对约束互补而不矛盾，10 项可同时成立，结论为自洽。

## 禁 mock 边清单

（本单纯文档改动，无调度、状态机、跨模块、生命周期或 DB 写路径改动，N/A。）

## 真实调用方请求 shape

N/A — 文档描述既有接口，不新增或修改调用方请求 shape；文档须按 PRD 原样记录 Bearer 鉴权及 payload 字段。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（静态文档交付，不执行外部系统接缝，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查未知 role 是否被文档误列为支持。
- 重复提交: 检查相同字段是否在不同章节出现互相矛盾的必填性。
- 中途中断: N/A（静态文档）。
- 边界值: 检查九项/三项枚举是否使用“等”省略或出现第 N+1 项。
发现分级: P0/P1 → 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web（按 PRD 显式值；本任务仅运行仓库内静态文档 oracle）

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA="f277cc41ebc2ae7c4669f1c77e487663be2680e6"
SPRINT_DIR="sprints/coding-harness-20260903225033-ie81xl"
node "$SPRINT_DIR/tests/contract-oracles.mjs" all
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts"

# canonical git-diff scope oracle：固定实现基线；只从完整 diff 中排除冻结合同目录。
CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD -- . ":(exclude)$SPRINT_DIR/**")
[ "$CHANGED" = "docs/current/attempt-run-bridge-guide.md" ] || { echo "FAIL: 产品改动范围不唯一: $CHANGED"; exit 1; }
echo "OK: 10/10 oracle 通过，且唯一产品改动为 docs/current/attempt-run-bridge-guide.md"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明完整性 | `sprints/coding-harness-20260903225033-ie81xl/tests/attempt-run-bridge-guide.test.ts` | `四个独立章节与全部正负 oracle 同时成立` | 文档尚不存在，Vitest 至少 1 failure |

## Notes

- contract-gate: 使用 Cecelia 仓库现有 gate；本文仅采用可执行 node/git oracle。
- validation identity 在执行时由 Runner 注入；合同未固化任何 proposer attempt/capability UUID。
