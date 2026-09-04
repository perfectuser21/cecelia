# Sprint Contract Draft (Round 1)

## 合同基线与范围

- 权威实现基线：`bdaca81b5cbf78929fa3d8eeac2a24cae6113b98`（来自 `inputs.implementation_baseline`，冻结且跨角色、GAN 轮次不变）。
- 唯一产品交付物：`docs/current/attempt-run-bridge-guide.md`。
- 合同产物位于 `sprints/coding-harness-20260904034439-v1423a/`，范围检查必须排除 `sprints/**`。
- 不修改源代码、运行时测试、数据库、配置或其他文档。
- planner PRD 产物已验证：`sprints/coding-harness-20260904034439-v1423a/sprint-prd.md` @ `bdaca81b5cbf78929fa3d8eeac2a24cae6113b98`。

## Response Schema（推导来源: N/A）

N/A — 本 Sprint 仅新增使用说明文档，不改变 HTTP 响应或数据库 schema。文档中的 API 事实按冻结 PRD 字面记录。

## 已知约束（来自回归测试与历史来源）

- [`packages/brain/src/routes/__tests__/harness-attempt-run.test.js`] → 现有工厂测试验证路由可挂载与角色集合；本 Sprint 不修改该实现或测试。
- [`tests/gp/f1/step3-attempt-run-endpoint.test.js`] → 现有 Golden Path 回归覆盖 POST 创建、GET 查询及派发失败回滚；本文档合同只验证 PRD 要求的说明内容。
- [累积 FR] 本 line 暂无历史。
- context-manifest: N/A（PRD 的 `journey_id: none`，无可查询 journey）。
- Unified Map: `[MAP_NOT_CONFIGURED]`（task payload 的 `map_scope` 为空），不得回退到领域硬编码；无 `must_run_assertions`。
- contract-gate: 使用 Cecelia 仓 `packages/brain/src/lib/contract-gate.js`。
- gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文说明，准确覆盖两个端点、鉴权、九角色、payload/基线和失败回滚。 |
| NFR（做得多好） | 信息分为四个可定位章节；名称和值保持 PRD 字面；全部由 Vitest 与 bash 机械验收。 |
| Invariant（永不违反） | 仅改指定文档；权威实现基线固定为 `bdaca81b5cbf78929fa3d8eeac2a24cae6113b98`。 |
| 判定点（怎么知道） | 无现实状态推断；按文档正文解析章节、角色和禁止措辞。 |
| 保质期（何时过期） | API 契约变化时由 Harness 维护者同步更新文档；本 Sprint 不引入 token 或时效数据。 |
| 死亡告警（停了谁知道） | Sprint Tests 与范围 oracle 在内容缺失、漂移或多文件交付时立即失败。 |
| 失败语义（挂了怎么办） | 任一正文或范围断言失败即阻塞交付，不放行、不降级。 |
| 效果确认（已发≠已生效） | 从提交树读取真实文档并解析；从冻结 SHA 计算真实 diff，二者同时通过才算生效。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或章节/字面不符 | Vitest 非零退出并阻塞 | 是，修正文档后重跑 | 无 |
| 角色集合多项、少项或出现额外角色 | 封闭集合断言失败 | 是 | 无 |
| 冻结基线 diff 出现额外交付文件 | 范围断言失败 | 是 | 无 |

### 输入对抗面

N/A — 本 Sprint 不新增或修改对外 agent 输入面。

## 判定点登记说明

本任务没有模糊现实判定点；所有判定均由固定路径、字面集合和 Git diff 得出。不存在待用户确认的高风险判定点。

## 真实调用方请求 shape

N/A — 只编写现有 API 的说明文档，不创建请求、不改变调用方或服务端 shape。文档必须字面说明 POST 创建、GET 查询以及远端 Bearer 鉴权。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期或 DB 写边，N/A）

## 接缝清单

（本单仅验证仓库文档内容与 Git 范围，无真实世界接缝，N/A）

## Golden Path

独立小路（无父路）

调用方阅读说明 → 区分端点与鉴权 → 选择封闭角色并组装 payload → 查询结果并理解派发失败回滚。

### Step 1: 找到中文桥接说明

**来源**: `[FROM_PRD]` — PRD「背景」「范围限定」要求在 `docs/current/` 新增一页中文说明。

**可观测行为**: 固定路径文档存在，标题为《attempt-run 桥接使用说明》，正文含连续中文内容。

**验证命令与硬阈值**: `npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t '文档存在且标题和正文为中文'`；必须 exit 0，英文标题替代或中文正文不足必须失败。

### Step 2: 区分创建、查询和鉴权

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1、2 项及边界情况明确两个端点用途与远端鉴权。

**可观测行为**: 「端点与鉴权」章节将 POST 描述为创建/派发、GET 描述为查询/轮询；说明 `internalAuthOrLoopback`，并要求宿主/远端携带 `Bearer CECELIA_INTERNAL_TOKEN`。

**验证命令与硬阈值**: 同一测试文件中 `创建与查询端点用途明确且不可互换` 与 `鉴权区分 loopback 与宿主远端且不可宣称远端免鉴权` 必须同时 exit 0；用途互换或远端免鉴权措辞必须失败。

### Step 3: 使用九角色封闭集合组装 payload

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3、4 项给出九项角色与 payload/基线规则。

**可观测行为**: 从「角色白名单」章节反引号项目现场提取角色，排序后必须恰好等于九项 PRD 集合；payload 三字段必填，`base_sha` 可省略并由生产 Brain 自解析，workspace SHA 不得替代实现基线。

**验证命令与硬阈值**: 同一测试文件中角色、payload、基线三项测试必须 exit 0；角色数量必须 `=9`、不得多项少项，`base_sha` 被写成必填或 workspace 替代基线必须失败。

### Step 4: 理解派发失败出口

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5、6 项及边界情况要求三个对象完整终态。

**可观测行为**: 「派发失败自动回滚」章节同时出现 `run→failed`、`session→closed`、`task→cancelled`，且不把失败描述成部分成功或其他终态。

**验证命令与硬阈值**: 对应 Vitest 必须 exit 0；三个状态缺一、出现部分成功或冲突终态均必须失败。

### Step 5: 交付范围闭合

**来源**: `[AI_ADDED]` — 将 PRD「不改任何代码、只新增一页」转换为冻结基线上的不可绕过范围 oracle。

**可观测行为**: 排除 Sprint 合同产物后，冻结基线至当前树的文件清单恰好是 `docs/current/attempt-run-bridge-guide.md`。

**验证命令与硬阈值**: `git diff --name-only bdaca81b5cbf78929fa3d8eeac2a24cae6113b98 -- . ':(exclude)sprints/**'` 的排序非空行数组必须严格等于唯一文档路径；任何额外文件或不同路径必须失败。

## 断言自洽声明

先完整列出并现场计数的测试体为：①中文文档；②端点用途；③鉴权边界；④九角色封闭集合；⑤payload/base_sha；⑥实现基线；⑦失败回滚；⑧四章节与无占位；⑨冻结基线交付范围。总数恰好 **9**。

逐对推演 36 个断言对：①只约束语言/标题；②只约束端点用途；③只约束鉴权；④只约束角色集合；⑤只约束字段必填性；⑥只约束 SHA 语义；⑦只约束失败终态；⑧只约束章节骨架与占位词；⑨只约束 Git 文件集合。各测试的正向要求均配有同主题负向 oracle，字段、状态、路径和角色集合互不改写；任意两项可同时满足，不存在互斥结论。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 在文档中搜索拼错的端点、字段、角色及状态箭头。
- 重复提交: 检查相同角色是否重复列出并借重复项伪装九项。
- 中途中断: N/A，静态文档无执行中状态。
- 边界值: 空章节、仅标题、额外第十角色、额外交付文件。
发现分级: P0/P1（错误鉴权、错误 payload 或错误回滚）阻塞 merge；P2/P3 记 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web（PRD 显式指定；本 Sprint 无 UI，验收仓库中的静态文档）

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA='bdaca81b5cbf78929fa3d8eeac2a24cae6113b98'
SPRINT_DIR='sprints/coding-harness-20260904034439-v1423a'
DOC='docs/current/attempt-run-bridge-guide.md'
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts" --reporter=verbose
mapfile -t DELIVERED < <(git diff --name-only "$BASE_SHA" -- . ':(exclude)sprints/**' | sed '/^$/d' | sort)
[ "${#DELIVERED[@]}" -eq 1 ]
[ "${DELIVERED[0]}" = "$DOC" ]
git diff --name-only "$BASE_SHA" -- . ':(exclude)sprints/**' | grep -Ev '^docs/current/attempt-run-bridge-guide\.md$' && exit 1 || :
echo 'PASS: 九个机械断言与唯一文档范围均满足'
```

通过标准：脚本 exit 0；失败标准：任一测试或严格文件集合断言非零退出。全程无需人工确认。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 中文文档 | `sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts` | 文档存在且标题和正文为中文 | 文档未实现时 ENOENT，测试失败 |
| 端点用途 | `sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts` | 创建与查询端点用途明确且不可互换 | 文档未实现时 ENOENT，测试失败 |
| 鉴权边界 | `sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts` | 鉴权区分 loopback 与宿主远端且不可宣称远端免鉴权 | 文档未实现时 ENOENT，测试失败 |
| 九角色封闭集合 | `sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts` | 角色白名单恰好九项并拒绝任何额外角色 | 文档未实现时 ENOENT，测试失败 |
| payload | `sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts` | payload 三个字段必填且 base_sha 不可写成必填 | 文档未实现时 ENOENT，测试失败 |
| 基线不变 | `sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts` | 实现基线保持不变且 workspace base_sha 不得替代 | 文档未实现时 ENOENT，测试失败 |
| 回滚出口 | `sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts` | 派发失败回滚三个对象到唯一终态且不可描述为部分成功 | 文档未实现时 ENOENT，测试失败 |
| 章节完整性 | `sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts` | 四个必需章节完整且没有人工确认占位 | 文档未实现时 ENOENT，测试失败 |
| 交付范围 | `sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts` | 交付范围相对冻结基线恰好只有 docs/current 下一页说明文档 | 文档未实现时文件集合为空，测试失败 |
