# Sprint Contract Draft (Round 1)

## 基线与范围

- 权威实现基线：`37fc357d927b1429de59e1b50e4de762c5e7ea18`（来自 `inputs.implementation_baseline.base_sha`）。PRD 内旧的 `559921...` 假设不得替换该基线。
- 产品交付仅新增 `docs/current/attempt-run-bridge-guide.md`；不得修改代码、既有文档或其他产品文件。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- `[MAP_NOT_CONFIGURED]`：task payload 未提供有效 map scope/repo；无 `must_run_assertions`，不回退到硬编码地图。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: N/A）

N/A — 本任务只新增说明文档，不新增或修改 HTTP 响应。

## 已知约束

- `[回归测试] packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 角色白名单为冻结的九项集合，路由包含 `/attempt-run` 与 `/attempt-run/:attemptId`。
- `[实现事实] packages/brain/src/routes/harness-attempt-run.js` → POST 异步派发，GET 轮询结构化结果，两个端点均使用 `internalAuthOrLoopback`。
- `[累积FR]` 本 line 暂无历史。
- context-manifest: journey_id 未配置，N/A。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接使用说明，覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 内容可由冻结 Vitest 结构化检查；不披露凭据；只新增一个产品文档文件。 |
| Invariant（永不违反） | 权威基线不漂移、凭据不硬编码、端点鉴权边界不写反、产品代码零改动。 |
| 判定点（怎么知道） | 由章节级解析与封闭集合断言判定，不靠关键词总量。 |
| 保质期（何时过期） | 服务端端点、角色或 payload 合同变化时由对应代码变更同步更新本页。 |
| 死亡告警（停了谁知道） | 冻结合同测试在文档缺失或语义漂移时由 required CI 报错。 |
| 失败语义（挂了怎么办） | 任一章节、封闭角色集合或范围断言失败即阻塞交付，不降级放行。 |
| 效果确认（已发≠已生效） | 读取提交树中的文档并运行冻结测试；产品 diff 精确等于目标文档。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节、含矛盾语义或角色集合不闭合 | Vitest 非零退出并阻塞交付 | 是 | 无降级 |
| 产品 diff 超出目标文档 | E2E 非零退出并阻塞交付 | 是 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入接口。

## 禁 mock 边清单

（本单纯文档改动，不触及调度、状态机、跨模块传递、生命周期或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 本任务记录既有调用合同，不实现或修改调用方；冻结测试依据生产路由源码的端点、鉴权与字段事实。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## Golden Path

独立小路（无父路）

[阅读说明] → [按鉴权选择调用方式] → [核对角色与 payload] → [理解成功查询及失败回滚]

### Step 1: 读者区分创建与查询端点
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 项。

**可观测行为**: 独立章节把 POST 解释为创建/派发，把 GET 解释为查询/轮询，写反即失败。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901233352-djtrpz/tests/attempt-run-bridge-guide.test.ts -t '端点用途与鉴权边界结构化且矛盾表述会失败'`

**硬阈值**: 指定测试 1/1 通过；命令退出码为 0。

### Step 2: 读者选择正确鉴权方式
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 项与「边界情况」。

**可观测行为**: 说明 `internalAuthOrLoopback`、开发环境 loopback 允许条件，以及宿主/远端必须携带 `Authorization: Bearer CECELIA_INTERNAL_TOKEN`；远端免鉴权等矛盾文字会失败。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901233352-djtrpz/tests/attempt-run-bridge-guide.test.ts -t '端点用途与鉴权边界结构化且矛盾表述会失败'`

**硬阈值**: 正向结构断言与矛盾变体负向断言全部通过；命令退出码为 0。

### Step 3: 读者核对封闭角色白名单
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项。

**可观测行为**: 角色章节恰好按服务端顺序列出九项角色，无缺项、别名或额外项。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901233352-djtrpz/tests/attempt-run-bridge-guide.test.ts -t '角色白名单恰好逐项列出九个服务端角色'`

**硬阈值**: 实际数组严格等于九项期望数组；命令退出码为 0。

### Step 4: 读者独立判断 payload 必填性
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项与「边界情况」。

**可观测行为**: `sprint_dir`、`base_repo`、`branch` 分别标为必填；`base_sha` 标为可省略且由生产 Brain 自解析。任一字段语义写反即失败。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901233352-djtrpz/tests/attempt-run-bridge-guide.test.ts -t 'payload 三个必填字段与 base_sha 可省略语义独立且矛盾表述会失败'`

**硬阈值**: 四个字段逐项断言和两个矛盾变体负向断言全部通过；命令退出码为 0。

### Step 5: 读者确认派发失败的完整回滚
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 项。

**可观测行为**: 失败章节同时给出 `run→failed`、`session→closed`、`task→cancelled`。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901233352-djtrpz/tests/attempt-run-bridge-guide.test.ts -t '派发失败回滚同时锁定 run session task 三个终态'`

**硬阈值**: 三个状态字面全部存在；命令退出码为 0。

### Step 6: 交付保持 docs-only 精确范围
**来源**: `[AI_ADDED]` — 将 PRD「不修改任何代码」转成防止附带改动的可执行集合相等断言。

**可观测行为**: 排除冻结合同目录后，权威实现基线到候选 HEAD 的变更路径严格只有目标文档。

**验证命令**: `bash -c 'ACTUAL=$(git diff --name-only 37fc357d927b1429de59e1b50e4de762c5e7ea18...HEAD -- . ":(exclude)sprints/coding-harness-20260901233352-djtrpz" | sort); EXPECTED="docs/current/attempt-run-bridge-guide.md"; [ "$ACTUAL" = "$EXPECTED" ]'`

**硬阈值**: 路径集合与期望集合字节级相等；命令退出码为 0。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web（仅使用本地 checkout 的 Node/Vitest 与 Git，不启动 UI 或服务）

```bash
#!/bin/bash
set -euo pipefail
IMPLEMENTATION_BASE_SHA="37fc357d927b1429de59e1b50e4de762c5e7ea18"
SPRINT_DIR="sprints/coding-harness-20260901233352-djtrpz"
GUIDE="docs/current/attempt-run-bridge-guide.md"
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts"
ACTUAL=$(git diff --name-only "$IMPLEMENTATION_BASE_SHA"...HEAD -- . ":(exclude)$SPRINT_DIR" | sort)
[ "$ACTUAL" = "$GUIDE" ] || { echo "FAIL: 产品变更路径不等于 $GUIDE: $ACTUAL"; exit 1; }
grep -q '[一-龥]' "$GUIDE" || { echo "FAIL: 文档缺少中文正文"; exit 1; }
grep -Fx 'task_request_hash: 239fe1b9cb13af9ee1c12171b0671dd016272a07bf59ddfda51e786809fc5946' "$GUIDE" >/dev/null
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 把 POST/GET 用途互换，确认测试失败。
- 重复提交: 重复角色项或追加第十项，确认封闭集合测试失败。
- 中途中断: 删除任一独立章节，确认结构解析失败。
- 边界值: 把任一必填字段写成可选，或把 `base_sha` 写成必填，确认负向 oracle 失败。
发现分级: P0/P1（鉴权误导、凭据泄露或范围越界）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 说明完整性 | `sprints/coding-harness-20260901233352-djtrpz/tests/attempt-run-bridge-guide.test.ts` | `端点用途与鉴权边界结构化且矛盾表述会失败`；`角色白名单恰好逐项列出九个服务端角色`；`payload 三个必填字段与 base_sha 可省略语义独立且矛盾表述会失败`；`派发失败回滚同时锁定 run session task 三个终态` | 目标文档尚不存在，Vitest 4 tests failed / ENOENT |

## 接缝清单

本任务不触碰真实世界接缝；仅验证提交树中文档与产品 diff，N/A。

## notes

- manager_feedback_ack：已把 endpoint/auth 边界拆成章节结构正向断言与矛盾变体负向断言；payload 四字段逐项断言；范围绑定权威实现基线并排除冻结合同目录。
- validation identity 由未来 Runner late-bind；合同不固化当前 proposer attempt 或 capability snapshot。
