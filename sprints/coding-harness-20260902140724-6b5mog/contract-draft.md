# Sprint Contract Draft (Round 1)

## Notes

- 实现基线：`d32b864de5adf8d3083c91f31ed3f5f7f58be985`（来自 `inputs.implementation_baseline.base_sha`）。
- `[MAP_NOT_CONFIGURED]`：task payload 未配置 `map_scope/map_repo`，无 `must_run_assertions`。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- gp-anchor: skipped (product-map.json not found)
- Registry 证据：API/DB/test registry 已读取；本任务不新增接口、数据库或产品测试模式。
- context-manifest: unavailable

## Response Schema（推导来源: PRD字面）

N/A — 本任务只新增使用说明，不改变 HTTP 响应。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 角色白名单封闭且恰好九项；路由包含 `/attempt-run` 和 `/attempt-run/:attemptId`。
- `packages/brain/src/middleware/internal-auth.test.js` → `internalAuthOrLoopback` 区分 loopback 与需要内部 token 的请求。
- [累积FR] 本 line 暂无历史；context-manifest 不可用。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|---|---|---|
| FR（做什么） | 功能需求 | 在 `docs/current/` 新增一页中文 attempt-run 桥接说明，准确覆盖端点、鉴权、九项角色、payload 与失败回滚。 |
| NFR（做得多好） | 非功能需求 | 与实现基线的生产 Brain 合同逐字对齐；唯一产品交付文件为一页文档。 |
| Invariant（永不违反） | 不变量 | 不修改产品代码、共享 CI、接口行为、鉴权、白名单或数据库状态。 |
| 判定点（怎么知道） | 判断方法 | 以实现基线中的路由常量、中间件及回滚 SQL 为权威。 |
| 保质期（何时过期） | 生命周期 | 路由合同变化时由该接口维护者同步更新本文档。 |
| 死亡告警（停了谁知道） | 失效发现 | 冻结文档测试与 E2E 内容断言在 CI 中失败。 |
| 失败语义（挂了怎么办） | 故障策略 | 任一必备章节、精确角色或状态缺失即验收失败，不放行。 |
| 效果确认（已发≠已生效） | 真实效果 | 读取最终提交中的文档并对照基线路由源码机械断言。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或内容漂移 | 测试非零退出并阻塞交付 | 是 | 无降级，修正文档后重验 |
| 产品范围外文件变化 | git diff 范围断言失败 | 是 | 无降级，移除越界变更 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入入口。

## 真实调用方请求 shape

文档必须说明：两个端点均使用 `internalAuthOrLoopback`；生产 Brain 配置 token 后，宿主或远端调用须发送 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。POST 请求体包含顶层 `role`、`title` 及 `payload`；本 PRD 限定 payload 必填 `sprint_dir`、`base_repo`、`branch`，`base_sha` 可省略并由生产 Brain 解析。本文档不创造第二种认证或 payload shape。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 禁 mock 边清单

（本单纯文档改动，不改调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A）

## Golden Path

独立小路（无父路）

[阅读说明] → [准备鉴权与角色] → [POST 派发] → [GET 查询] → [识别失败回滚]

### Step 1: 找到并理解两个桥接端点
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 项。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 为中文说明，并分别解释 POST 创建/异步派发与 GET 按 attempt id 轮询结构化结果的用途。

**验证命令**: `npx vitest run sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t "两个端点用途完整" --reporter=verbose`

**硬阈值**: 两个完整端点字面值及各自用途均出现；命令 exit 0。

### Step 2: 按正确鉴权与封闭角色集准备请求
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 2、3 项。

**可观测行为**: 文档区分开发环境未配置 token 时的同机 loopback 与生产/宿主/远端请求；后者明确携带 Bearer token。角色白名单以九个独立条目列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，不描述为开放集合。

**验证命令**: `npx vitest run sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts --reporter=verbose`

**硬阈值**: 精确九项，无缺项、增项或改名；鉴权关键字全部命中；命令 exit 0。

### Step 3: 构造 payload 并由生产 Brain 解析可选基线
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 4 项。

**可观测行为**: 文档明确 payload 必填 `sprint_dir`、`base_repo`、`branch`，且 `base_sha` 可省略，由生产 Brain 自动解析，而非调用方必填。

**验证命令**: `npx vitest run sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts --reporter=verbose`

**硬阈值**: 四个字段及必填/可省略语义均由测试断言；命令 exit 0。

### Step 4: 查询结果并识别派发失败回滚完成
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 5 项。

**可观测行为**: 文档说明派发失败自动回滚为 `run→failed`、`session→closed`、`task→cancelled`，三个对象及终态缺一不可。

**验证命令**: `npx vitest run sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts --reporter=verbose`

**硬阈值**: 三条状态迁移全部精确出现；命令 exit 0。

## 接缝清单

（本任务只冻结现有合同的文档，不触碰真实世界接缝，N/A）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否把未知 role 描述为可接受。
- 重复提交: N/A，纯静态文档。
- 中途中断: N/A，纯静态文档。
- 边界值: 检查 `base_sha` 是否被误写成必填，或把远端误写成免鉴权。
发现分级: P0/P1（鉴权误导、角色或回滚状态错误）阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR='sprints/coding-harness-20260902140724-6b5mog'
DOC='docs/current/attempt-run-bridge-guide.md'
BASE_SHA='d32b864de5adf8d3083c91f31ed3f5f7f58be985'
npx vitest run "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts" --reporter=verbose
test "$(git diff --name-only "$BASE_SHA"...HEAD | grep -Ev "^($SPRINT_DIR/(contract-draft.md|contract-dod.md|task-plan.json|tests/attempt-run-bridge-guide.test.ts)|docs/current/attempt-run-bridge-guide.md)$" | wc -l)" -eq 0
test "$(git diff --name-only "$BASE_SHA"...HEAD | grep -c '^docs/current/.*\.md$')" -eq 1
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -q 'run→failed' "$DOC"
grep -q 'session→closed' "$DOC"
grep -q 'task→cancelled' "$DOC"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 文档完整性 | `sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts` | 两个端点用途完整；鉴权与九项角色白名单准确；payload 必填项与可选 base_sha 准确；派发失败三对象回滚完整 | 文档尚不存在，4 个 `it()` 均失败 |
