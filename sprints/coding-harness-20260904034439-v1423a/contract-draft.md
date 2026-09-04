# Sprint Contract Draft (Round 1)

## Notes

- 权威实现基线：`bdaca81b5cbf78929fa3d8eeac2a24cae6113b98`；角色 checkout 的 workspace base SHA 不得替代它。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- `[MAP_NOT_CONFIGURED]`：任务 payload 未提供可用的字符串 `map_scope`/`map_repo`，无 Unified Map 回归断言。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: N/A）

N/A — 本 Sprint 仅新增说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [sprint-prd.md / Invariant] Planner workspace 必须保持服务端签发的 planner_branch，Provider 只校验而不切换分支；本 Sprint 不触及该实现。
- [sprint-prd.md / Invariant] Dispatcher 与 Fleet Worker 使用服务端权威 HARNESS_BRAIN_URL 且预检 fail-closed；本 Sprint 不触及该实现。
- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] 路由必须包含 `/attempt-run` 与 `/attempt-run/:attemptId`。
- [累积FR] 本 line 暂无历史；`journey_id=none`，context-manifest 无可用清单。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文说明，覆盖创建、查询、鉴权、九角色、payload、冻结基线与失败回滚。 |
| NFR（做得多好） | 专有名词逐字准确；四个主题可按二级标题定位；除该页外不交付其他非 sprint 文件。 |
| Invariant（永不违反） | 不改代码；实现基线固定为 `bdaca81b5cbf78929fa3d8eeac2a24cae6113b98`。 |
| 判定点（怎么知道） | 由冻结 Vitest 从文档现场提取清单并做正反向 oracle。 |
| 保质期（何时过期） | 端点、角色或 payload 契约变化时由对应 Brain 变更维护者同步更新。 |
| 死亡告警（停了谁知道） | Sprint Tests/范围 oracle 失败即阻塞 CI。 |
| 失败语义（挂了怎么办） | 任一内容或范围断言失败即 fail-closed，不接受人工确认。 |
| 效果确认（已发≠已生效） | 读取实际提交中的文档并验证内容；从冻结基线计算交付文件集合。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或内容不全 | 测试非零退出并阻塞合并 | 是 | 无降级 |
| 出现范围外文件 | 测试非零退出并阻塞合并 | 是 | 无降级 |

### 输入对抗面

N/A — 不新增对外 Agent 或输入面。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期或 DB 写路径，N/A）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 真实调用方请求 shape

N/A — 本 Sprint 只记录既有接口，不修改设备/agent 到服务端的请求 shape。

## Golden Path

独立小路（无父路）

[阅读说明] → [创建 attempt] → [查询 attempt] → [理解失败回滚]

### Step 1: 找到中文说明并区分两个端点
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1、6 项。

**可观测行为**: 文档标题为《attempt-run 桥接使用说明》，POST 明确用于创建/派发，GET 明确用于查询/轮询。

**验证命令**: `npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t '文档中文标题与两个端点用途完整'`

**硬阈值**: 两端点字面均出现、用途不混淆，且对应负向变体必须被拒绝；命令 exit 0。

### Step 2: 按调用位置应用鉴权
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 项与「边界情况」。

**可观测行为**: 文档写明 `internalAuthOrLoopback`；loopback 与宿主/远端要求分开，后者必须带 `Bearer CECELIA_INTERNAL_TOKEN`。

**验证命令**: `npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t '鉴权说明区分 loopback 与宿主远端'`

**硬阈值**: 鉴权标识与令牌字面均存在，误写远端免鉴权的负向变体被拒绝；命令 exit 0。

### Step 3: 从文档提取封闭角色集合
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项。

**可观测行为**: `## 角色白名单` 下的反引号列表现场提取后恰好九项、无重复，且集合严格等于 PRD 九角色。

**验证命令**: `npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t '角色白名单从文档提取后恰好九项封闭集合'`

**硬阈值**: 现场计数 `length=9`、集合大小 `9`、无缺项且拒绝额外角色；命令 exit 0。

### Step 4: 组装 payload 且保持实现基线
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项。

**可观测行为**: 文档列出 `sprint_dir`、`base_repo`、`branch` 必填；`base_sha` 可省略并由生产 Brain 自解析；实现基线跨角色/GAN 不变，workspace base_sha 不得替代。

**验证命令**: `npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t 'payload 三个必填字段与 base_sha 生产解析及冻结基线规则完整'`

**硬阈值**: 三字段、可省略、自解析、冻结基线、不得替代五类断言全真且反向写法被拒绝；命令 exit 0。

### Step 5: 理解派发失败自动回滚
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 项。

**可观测行为**: 文档同时写明派发失败自动回滚及 `run→failed`、`session→closed`、`task→cancelled`。

**验证命令**: `npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t '派发失败自动回滚三个终态完整'`

**硬阈值**: 三终态不可缺且部分成功负向表述被拒绝；命令 exit 0。

### Step 6: 确认唯一文档交付范围
**来源**: `[AI_ADDED]` — 把 PRD「不改任何代码」与唯一交付物转成不可被 sprint 合同产物干扰的机械范围 oracle。

**可观测行为**: 相对冻结实现基线取 git diff，排除 `sprints/` 后清单恰好为 `docs/current/attempt-run-bridge-guide.md`。

**验证命令**: `npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t '交付范围相对冻结基线排除 sprints 后恰好只有 docs current 一页说明且无代码'`

**硬阈值**: 完整清单逐字等于单元素数组且代码扩展名计数为 0；命令 exit 0。

## 断言自洽声明

冻结测试完整列出 6 个 `it()` 断言：端点用途、鉴权、九角色封闭集合、payload/基线、三对象回滚、唯一文件范围。现场计数为 6。逐对推演后无互斥：前五项只约束同一文档的互补章节，第六项只约束相对固定基线的文件集合；所有正向内容断言都在同一测试体内构造缺失、替换或额外值的负向样本并要求拒绝。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=bdaca81b5cbf78929fa3d8eeac2a24cae6113b98
GUIDE=docs/current/attempt-run-bridge-guide.md
test "$(git diff --name-only "$BASE_SHA...HEAD" | grep -v '^sprints/' | wc -l | tr -d ' ')" -eq 1
test "$(git diff --name-only "$BASE_SHA...HEAD" | grep -v '^sprints/')" = "$GUIDE"
npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts --reporter=verbose
```

通过标准：脚本 exit 0；失败标准：任何断言非零退出。该文档 Sprint 无 UI 交互，不以 Playwright 页面断言替代仓库内容验收。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查是否把 `base_sha` 误列为必填。
- 重复提交: 检查九角色是否重复导致表面计数九项但集合不足。
- 中途中断: N/A，静态文档无异步过程。
- 边界值: 在角色章节增加第十个角色应确定失败。
发现分级: P0/P1（误导调用方或越权角色）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明完整契约 | `sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts` | `文档中文标题与两个端点用途完整`；`鉴权说明区分 loopback 与宿主远端`；`角色白名单从文档提取后恰好九项封闭集合`；`payload 三个必填字段与 base_sha 生产解析及冻结基线规则完整`；`派发失败自动回滚三个终态完整`；`交付范围相对冻结基线排除 sprints 后恰好只有 docs current 一页说明且无代码` | 目标文档尚不存在，至少 1 failure |
