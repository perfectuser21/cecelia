# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A）

N/A — 本任务只新增说明文档，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 角色白名单必须恰为九项，并包含 `canary/planner/generator/generator-fix/judge`。
- `packages/brain/src/middleware/internal-auth.test.js` → `internalAuthOrLoopback` 对 loopback 与已配置 token 的行为已有回归约束。
- `[累积FR] context-manifest: unavailable`。
- `[MAP_NOT_CONFIGURED]` task payload 未配置可查询的 Unified Map scope/repo；`must_run_assertions` 为空。

gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文说明，准确覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 单页可独立阅读；所有名称与生产源码逐字一致。 |
| Invariant（永不违反） | 只改 `docs/current/attempt-run-bridge-guide.md`；不修改生产代码。 |
| 判定点（怎么知道） | 由冻结 Vitest 与 E2E 脚本逐项检查正文。 |
| 保质期（何时过期） | 端点、白名单、鉴权或回滚语义变化时由对应代码变更同步维护。 |
| 死亡告警（停了谁知道） | 文档契约测试在 Sprint Tests 中失败并阻塞合并。 |
| 失败语义（挂了怎么办） | 任一必备章节或字面事实缺失即验收失败，不降级放行。 |
| 效果确认（已发≠已生效） | 从提交树读取目标文档并验证中文、章节与全部关键字。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或事实不完整 | 测试非零退出并阻塞合并 | 是 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入入口。

## Golden Path

独立小路（无父路）

[维护者打开文档] → [理解端点与鉴权] → [选择合法角色并构造 payload] → [理解失败回滚]

### Step 1: 定位桥接端点与鉴权方式

**来源**: `[FROM_PRD]` — PRD「验收范围」第 1 项。

**可观测行为**: 读者能在同一节看到 POST 派发、GET 轮询、`internalAuthOrLoopback` 与宿主/远端 Bearer 要求。

**验证命令**: `node sprints/coding-harness-20260831042346-jlgxtw/tests/verify-attempt-run-guide.mjs endpoints`

**硬阈值**: 两个端点、鉴权中间件、Bearer header 与 `CECELIA_INTERNAL_TOKEN` 全部出现；命令 exit 0。

### Step 2: 选择允许的执行角色

**来源**: `[FROM_PRD]` — PRD「验收范围」第 2 项。

**可观测行为**: 文档逐字列出生产端允许的九项角色，无缺项。

**验证命令**: `node sprints/coding-harness-20260831042346-jlgxtw/tests/verify-attempt-run-guide.mjs roles`

**硬阈值**: 九项角色全部出现且明确写明“九项”；命令 exit 0。

### Step 3: 构造派发 payload

**来源**: `[FROM_PRD]` — PRD「验收范围」第 3 项。

**可观测行为**: 文档明确 `sprint_dir/base_repo/branch` 必填，`base_sha` 可省略并由生产 Brain 解析。

**验证命令**: `node sprints/coding-harness-20260831042346-jlgxtw/tests/verify-attempt-run-guide.mjs payload`

**硬阈值**: 三个必填字段及 `base_sha` 省略语义全部出现；命令 exit 0。

### Step 4: 识别派发失败后的自动回滚

**来源**: `[FROM_PRD]` — PRD「验收范围」第 4 项。

**可观测行为**: 文档明确 run、session、task 三类资源的终态。

**验证命令**: `node sprints/coding-harness-20260831042346-jlgxtw/tests/verify-attempt-run-guide.mjs rollback`

**硬阈值**: `run → failed`、`session → closed`、`task → cancelled` 三组映射全部出现；命令 exit 0。

## 真实调用方请求 shape

N/A — 本任务不新增或修改调用方；文档示例仅复述现有 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN` 与既有 JSON 字段。

## 禁 mock 边清单

（本单纯文档改动，无调度、状态机、跨模块、生命周期或 DB 写路径变更，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本单只交付静态文档，无真实世界接缝，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误把任意角色或 payload 字段描述为可选。
- 重复提交: N/A，静态文档无提交动作。
- 中途中断: N/A，静态文档无运行流程。
- 边界值: 对照生产源码确认九项角色无漏项、无同义改名。
发现分级: P0/P1（安全鉴权错误或会导致错误派发）阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
SPRINT_DIR="sprints/coding-harness-20260831042346-jlgxtw"
DOC="docs/current/attempt-run-bridge-guide.md"
test -f "$DOC"
node "$SPRINT_DIR/tests/verify-attempt-run-guide.mjs" all
git diff --name-only f06b922d05c1105783b66c22b5912d3430dc2d44...HEAD | awk '!/^docs\/current\/attempt-run-bridge-guide.md$/ && !/^sprints\/coding-harness-20260831042346-jlgxtw\// {print; bad=1} END {exit bad ? 1 : 0}'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 文档四节与范围约束 | `sprints/coding-harness-20260831042346-jlgxtw/tests/attempt-run-bridge-guide.test.ts` | `说明两个端点及 internalAuthOrLoopback 鉴权`、`列出九项角色白名单`、`说明 payload 必填字段和 base_sha 省略语义`、`说明派发失败的三资源回滚终态`、`目标文档为中文且本 sprint 不要求代码改动` | 目标文档尚不存在，测试读取文件时失败 |

## Notes

- implementation baseline: `f06b922d05c1105783b66c22b5912d3430dc2d44`（跨角色与 GAN 轮次保持不变）。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)。

