# Sprint Contract Draft (Round 3)

## 基线与范围

- authoritative implementation baseline: `perfectuser21/cecelia@5d25dcd6addb8ba30c742281b682589a3b95eaab`；`workspace_spec.base_sha` 只选择本角色 checkout，不替换该基线。
- 唯一产品交付文件为 `docs/current/attempt-run-bridge-guide.md`；不修改任何代码、接口、测试、数据库或运行行为。Sprint 冻结合同与测试产物不计为产品实现文件。
- `[MAP_NOT_CONFIGURED]`：payload 未配置可用的 map scope/repo，`must_run_assertions` 为空。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists).
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: N/A）

N/A — 纯文档任务，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 两个 attempt-run 路由存在，角色白名单由实现导出。
- `packages/brain/src/middleware/internal-auth.test.js` → loopback 与 Bearer 鉴权边界不得混淆。
- [累积 FR] context-manifest 未在 bundle 提供，且 Map 未配置；`context-manifest: unavailable`。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增中文说明，覆盖端点、鉴权、九项角色、payload 和失败回滚。 |
| NFR（做得多好） | 五类信息完整且与权威基线逐字一致。 |
| Invariant（永不违反） | 仅新增目标产品文档；不泄露 token；不修改运行行为。 |
| 判定点（怎么知道） | 冻结 Vitest 读取 Git 工作树中的真实文档并断言。 |
| 保质期（何时过期） | 对应接口契约变化时由实现变更同步更新。 |
| 死亡告警（停了谁知道） | Sprint Tests 失败并阻塞 PR。 |
| 失败语义（挂了怎么办） | 任一章节或精确值缺失即非零退出、禁止交付。 |
| 效果确认（已发≠已生效） | 内容测试通过，且基线 diff 证明产品范围只有目标文档。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或内容漂移 | 测试失败并阻塞交付 | 是 | 无降级 |
| 产品范围出现额外文件 | E2E 非零退出 | 是 | 删除越界变更 |

### 输入对抗面

N/A — 不新增对外 agent 或输入面。

## Golden Path

独立小路（无父路）

[阅读说明] → [理解端点及鉴权] → [选择角色并构造 payload] → [识别失败回滚]

### Step 1: 找到中文说明并理解两个端点
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 项。

**可观测行为**: 中文文档分别说明 POST 发起和 GET 查询用途。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t '文档为中文且分别说明 POST 发起与 GET 查询用途'
```
**硬阈值**: 目标用例 exit code = 0。

### Step 2: 正确理解鉴权边界
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 项。

**可观测行为**: 文档说明 `internalAuthOrLoopback`，宿主/远端必须带 `Bearer CECELIA_INTERNAL_TOKEN`，且不展示真实 token。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t '鉴权节区分 loopback 与宿主远端 Bearer 要求且不泄露令牌'
```
**硬阈值**: 目标用例 exit code = 0。

### Step 3: 选择受支持角色
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 项。

**可观测行为**: 文档按实现顺序逐项列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，并声明白名单外不支持。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t '角色白名单完整列出九项且明确白名单外不支持'
```
**硬阈值**: 列表精确等于九项且目标用例 exit code = 0。

### Step 4: 构造 payload
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 项。

**可观测行为**: `sprint_dir`、`base_repo`、`branch` 标为必填；`base_sha` 可省略并由生产 Brain 自解析。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t 'payload 节声明三个必填字段及 base_sha 生产自解析'
```
**硬阈值**: 三项必填与一项省略语义同时命中，exit code = 0。

### Step 5: 识别失败回滚出口
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 项。

**可观测行为**: 文档按顺序展示 `run→failed/session→closed/task→cancelled`。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t '派发失败节完整说明 run session task 的回滚终态和顺序'
```
**硬阈值**: 三段终态及顺序精确命中，exit code = 0。

## 真实调用方请求 shape

N/A — 纯文档变更不改请求 shape；文档解释既有接口。

## 禁 mock 边清单

（本单纯文档改动，无接缝边，N/A）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 接缝清单

（静态版本化文档无真实世界接缝，N/A）

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=5d25dcd6addb8ba30c742281b682589a3b95eaab
SPRINT=sprints/coding-harness-20260901143907-ajny7e
npx vitest run --no-cache "$SPRINT/tests/attempt-run-bridge-guide.test.ts" --reporter=verbose
PRODUCT_FILES=$(git diff --name-only "$BASE_SHA"...HEAD -- docs/current packages apps scripts | sort)
[ "$PRODUCT_FILES" = 'docs/current/attempt-run-bridge-guide.md' ] || { echo "FAIL: 产品变更范围不唯一: $PRODUCT_FILES"; exit 1; }
```

通过标准：冻结测试 5/5 通过；相对权威基线，产品路径变更集合精确等于目标文档。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查白名单外 role 是否被误写为受支持。
- 重复提交: N/A（静态文档）。
- 中途中断: N/A（静态文档）。
- 边界值: 检查 `base_sha` 是否误写为必填，或 loopback 例外是否扩张到远端。
发现分级: P0/P1（泄密或导致错误免鉴权）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 端点用途 | `sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts` | 文档为中文且分别说明 POST 发起与 GET 查询用途 | 目标文档缺失，ENOENT |
| 鉴权 | `sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts` | 鉴权节区分 loopback 与宿主远端 Bearer 要求且不泄露令牌 | 目标文档缺失，ENOENT |
| 角色 | `sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts` | 角色白名单完整列出九项且明确白名单外不支持 | 目标文档缺失，ENOENT |
| payload | `sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts` | payload 节声明三个必填字段及 base_sha 生产自解析 | 目标文档缺失，ENOENT |
| 回滚 | `sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts` | 派发失败节完整说明 run session task 的回滚终态和顺序 | 目标文档缺失，ENOENT |
