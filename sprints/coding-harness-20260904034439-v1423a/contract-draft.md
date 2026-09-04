# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A）

N/A — 本 Sprint 仅新增使用说明文档，不改变或验收 HTTP 响应 schema。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 路由必须同时注册 `/attempt-run` 与 `/attempt-run/:attemptId`；本 Sprint 只记录既有事实，不修改代码。
- [累积 FR] 本 line 暂无历史。
- Unified Map: `[MAP_NOT_CONFIGURED]`；无 `must_run_assertions`。
- 实现基线固定为 `bdaca81b5cbf78929fa3d8eeac2a24cae6113b98`，不得用角色 checkout SHA 替代。

gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接使用说明，覆盖 PRD 四类信息。 |
| NFR（做得多好） | 四个可定位章节；名称、字段和状态字面准确；唯一交付文件。 |
| Invariant（永不违反） | 不修改代码；实现基线 SHA 在角色及 GAN 轮次间保持不变。 |
| 判定点（怎么知道） | 由冻结 Vitest 从文档章节提取内容并按封闭集合判定。 |
| 保质期（何时过期） | 当 attempt-run 接口契约变化时由接口维护者同步更新。 |
| 死亡告警（停了谁知道） | 冻结测试与范围 oracle 在 CI 中失败并阻塞合入。 |
| 失败语义（挂了怎么办） | 任一断言失败即验收失败，不降级、不放行。 |
| 效果确认（已发≠已生效） | 从最终提交读取文档并验证章节内容及 git diff 范围。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失、内容不全或范围越界 | 测试非零退出并阻塞合入 | 是 | 无降级 |

### 输入对抗面

N/A — 本 Sprint 不新增对外 Agent 或可写接口。

## Golden Path

独立小路（无父路）

[阅读说明] → [按要求鉴权并创建 attempt] → [查询 attempt] → [理解失败回滚]

### Step 1: 定位两个端点及鉴权规则
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1、2 项。

**可观测行为**: 读者能在“端点与鉴权”章节区分 POST 创建/派发与 GET 查询/轮询，并确认宿主或远端必须携带 Bearer token。

**验证命令**: `npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t '端点与鉴权章节同时说明创建查询用途和远端 Bearer 要求'`

**硬阈值**: 两个端点、两个用途、`internalAuthOrLoopback`、`Bearer CECELIA_INTERNAL_TOKEN` 全部命中，且不存在宿主/远端免鉴权表述；命令 exit 0。

### Step 2: 使用封闭九角色白名单
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 3 项。

**可观测行为**: 读者看到恰好九个逐行代码标识角色，集合完全等于 PRD 白名单，任何额外角色都会失败。

**验证命令**: `npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t '角色白名单章节是恰好九项的封闭集合且拒绝额外角色'`

**硬阈值**: 现场提取条目数 = 9、集合相等、每项均属于期望集合；命令 exit 0。

### Step 3: 组装 payload 并保持实现基线
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 4 项。

**可观测行为**: 读者确认仅 `sprint_dir`、`base_repo`、`branch` 被标作必填，`base_sha` 可省略并由生产 Brain 自解析，workspace SHA 不得替代实现基线。

**验证命令**: `npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t 'payload 章节限定三个必填字段并说明 base_sha 省略与冻结基线'`

**硬阈值**: 现场提取必填字段有序列表严格等于三项；正向语义全部命中；`base_sha` 必填反向 oracle 不命中；命令 exit 0。

### Step 4: 判断派发失败后的完整回滚
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 5、6 项。

**可观测行为**: 读者能看到失败时三对象进入明确终态，且不会误解为部分成功。

**验证命令**: `npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t '派发失败自动回滚章节声明三个且仅三个关联终态'`

**硬阈值**: 现场提取迁移列表严格等于 `run→failed`、`session→closed`、`task→cancelled`，反向误导词不命中；命令 exit 0。

### Step 5: 限定唯一交付范围
**来源**: `[AI_ADDED]` — 将 PRD“不改任何代码”和唯一文档交付转成不可绕过的 diff oracle。

**可观测行为**: 排除 Sprint 合同产物后，相对冻结实现基线仅新增 `docs/current/attempt-run-bridge-guide.md`。

**验证命令**: `bash -c 'BASE=bdaca81b5cbf78929fa3d8eeac2a24cae6113b98; mapfile -t FILES < <(git diff --name-only "$BASE"...HEAD -- . ":(exclude)sprints/**"); [ "${#FILES[@]}" -eq 1 ] && [ "${FILES[0]}" = docs/current/attempt-run-bridge-guide.md ] && [ "$(git diff --diff-filter=A --name-only "$BASE"...HEAD -- docs/current/attempt-run-bridge-guide.md)" = docs/current/attempt-run-bridge-guide.md ]'`

**硬阈值**: 排除 `sprints/` 后变更文件总数 = 1，路径逐字相等且 diff-filter=A；命令 exit 0。

## 禁 mock 边清单

（本单纯文档改动，无调度、状态机、跨模块、生命周期或 DB 写路径改动，N/A。）

## 真实调用方请求 shape

N/A — 本 Sprint 不实现或调用端点，仅说明既有调用契约。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本 Sprint 仅文档交付，不触碰真实运行环境接缝，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否错误地把 `base_sha` 标为必填。
- 重复提交: 检查角色列表是否重复或出现第十项。
- 中途中断: N/A，静态文档无运行中状态。
- 边界值: 检查四章节标题缺失、空章节和额外交付文件。
发现分级: P0/P1 → 阻塞 merge；P2/P3 → 记录 findings 不阻塞。

## 断言自洽声明

冻结测试共 5 个 `it()` 断言体：文档/中文与路径、端点鉴权、九角色封闭集合、payload/基线、失败回滚；合同另有 1 个 git diff 范围 oracle，共 6 个顶层验收断言。逐项先列目标集合、再现场提取并计数；每个正向内容断言均配有负向 oracle（误导鉴权、额外角色、`base_sha` 必填、错误回滚语义、额外交付路径）。两两推演后不存在同一文本既要求出现又要求禁止、数量集合互斥或基线不一致，结论为无互斥。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=bdaca81b5cbf78929fa3d8eeac2a24cae6113b98
TEST_FILE=sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts
npx vitest run "$TEST_FILE" --reporter=verbose
mapfile -t DELIVERY_FILES < <(git diff --name-only "$BASE_SHA"...HEAD -- . ":(exclude)sprints/**")
[ "${#DELIVERY_FILES[@]}" -eq 1 ]
[ "${DELIVERY_FILES[0]}" = docs/current/attempt-run-bridge-guide.md ]
[ "$(git diff --diff-filter=A --name-only "$BASE_SHA"...HEAD -- docs/current/attempt-run-bridge-guide.md)" = docs/current/attempt-run-bridge-guide.md ]
echo 'PASS: 6/6 顶层验收断言通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts` | `文档存在于 docs/current 且是唯一新增交付页`；`端点与鉴权章节同时说明创建查询用途和远端 Bearer 要求`；`角色白名单章节是恰好九项的封闭集合且拒绝额外角色`；`payload 章节限定三个必填字段并说明 base_sha 省略与冻结基线`；`派发失败自动回滚章节声明三个且仅三个关联终态` | 文档尚未实现，读取 `docs/current/attempt-run-bridge-guide.md` 失败，至少 5 tests failed |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- 本合同只授权 Generator 新增 `docs/current/attempt-run-bridge-guide.md`；Sprint 下合同与冻结测试属于治理产物。
