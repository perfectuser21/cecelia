# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A）

N/A — 本任务只新增使用说明，不改变 HTTP 响应。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → 角色白名单封闭：包含九个执行角色，永不包含 commander/publisher。
- [累积FR] 本 line 暂无历史。
- [MAP_NOT_CONFIGURED] task payload 未配置 map_scope/map_repo；不作领域硬编码回退。

gp-anchor: skipped (product-map.json not found)

## Golden Path

独立小路（无父路）

[阅读中文说明] → [确认端点与鉴权] → [按封闭角色和 payload 发起请求] → [查询结果并识别失败回滚]

### Step 1: 找到唯一中文说明及四个主题节
**来源**: `[FROM_PRD]` — PRD“范围限定”要求仅在 `docs/current/` 新增一页中文说明并覆盖四节。
**可观测行为**: 文档恰有“端点用途、鉴权方式、角色白名单、payload 与失败回滚”四个二级节。
**验证命令与硬阈值**: `npx vitest run sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts -t '中文文档包含四节且不存在第五个一级主题节'`；恰好四节，顺序及中文正文均满足，任意第五节失败。

### Step 2: 识别两个桥接端点及鉴权边界
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1、2 项。
**可观测行为**: 逐项列出 POST 创建与 GET 查询两个端点；说明 loopback 中间件及宿主/远端 Bearer 要求。
**验证命令与硬阈值**: `npx vitest run sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts -t '两个端点逐项存在且机械拒绝任意第三端点|鉴权正向要求与远端无令牌负向禁令成对存在'`；端点封闭集合恰好两项，鉴权正反 oracle 同时成立。

### Step 3: 按角色与 payload 封闭集合发起请求
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3、4 项。
**可观测行为**: 九个角色先逐项完整列出再现场计数得恰好九项；三个必填字段先逐项完整列出再现场计数得恰好三项；明确 `base_sha` 可省略。
**验证命令与硬阈值**: `npx vitest run sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts -t '九个角色逐项存在且机械拒绝任意第十角色|三个必填字段与三个回滚终态分别构成封闭集合'`；角色恰好九项且拒绝第十项，必填字段恰好三项且拒绝第四项。

### Step 4: 判断派发失败后的三个回滚终态
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 项。
**可观测行为**: `run→failed`、`session→closed`、`task→cancelled` 先逐项完整列出再现场计数得恰好三项，并排除额外状态。
**验证命令与硬阈值**: `npx vitest run sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts -t '三个必填字段与三个回滚终态分别构成封闭集合'`；三项全部存在且任意第四项失败。

## 断言自洽声明

本合同共 10 组断言对（20 个方向）：四节、中文、两个端点、鉴权、九角色、拒绝第十角色、三必填字段、拒绝第四必填字段、base_sha 省略语义、三回滚终态/拒绝额外状态。每组先给正向存在/等值 oracle，再给负向越界/缺失 oracle；封闭集合均由逐项枚举后现场推导“恰好 N”，没有仅凭自然语言宣称数量。20 个方向两两配对，结论无互斥：正向要求集合内成员存在，负向拒绝集合外成员，不会同时要求同一成员既存在又不存在。

## 禁 mock 边清单

（本单纯文档改动，不触及调度、状态机、跨模块传递、生命周期或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 本任务不改变调用 shape；说明只照录现有生产端点名称、鉴权和 payload 约束。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR | 新增一页中文桥接说明，覆盖 PRD 四节 |
| NFR | 封闭枚举可机械解析；不改产品代码 |
| Invariant | 基线固定为 `033e0feae6474eff023a3974a94a17ad0a6a53b9`；凭据只写变量名，不写值 |
| 判定点 | 无接缝判定点，N/A |
| 保质期 | 随生产 attempt-run 合同变更同步修订 |
| 死亡告警 | 冻结测试在 Sprint Tests 中失败即告警 |
| 失败语义 | 文档缺项、增项或越界均 fail closed |
| 效果确认 | Vitest 解析正文封闭集合与 canonical diff 范围 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺项或集合越界 | 测试非零退出，阻塞交付 | 是 | 不降级 |

### 输入对抗面

N/A — 不新增对外 agent 或输入入口。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 搜索说明是否误称远端可免鉴权
- 重复提交: 检查同一角色或字段是否重复导致伪造计数
- 中途中断: N/A，静态文档无运行中状态
- 边界值: 检查第十角色、第四必填字段和第四回滚状态是否会被接受
发现分级: P0/P1 → 阻塞 merge；P2/P3 → 记 findings 不阻塞

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=033e0feae6474eff023a3974a94a17ad0a6a53b9
GUIDE=docs/current/attempt-run-bridge-guide.md
test -f "$GUIDE"
npx vitest run sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts
CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD)
EXPECTED=$(printf '%s\n' "$GUIDE" 'sprints/coding-harness-20260904093148-3cc0bn/contract-draft.md' 'sprints/coding-harness-20260904093148-3cc0bn/contract-dod.md' 'sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts' | sort)
[ "$(printf '%s\n' "$CHANGED" | sed '/^$/d' | sort)" = "$EXPECTED" ]
```

范围 oracle 逐字采用 coding-contract canonical git diff 模板：`CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD)`；其中冻结 `BASE_SHA=033e0feae6474eff023a3974a94a17ad0a6a53b9`，不得用角色 checkout SHA 替换。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 中文四节 | `sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts` | 中文文档包含四节且不存在第五个一级主题节 | 文档尚不存在，ENOENT |
| 端点封闭集合 | `sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts` | 两个端点逐项存在且机械拒绝任意第三端点 | 文档尚不存在，ENOENT |
| 鉴权正反约束 | `sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts` | 鉴权正向要求与远端无令牌负向禁令成对存在 | 文档尚不存在，ENOENT |
| 角色封闭集合 | `sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts` | 九个角色逐项存在且机械拒绝任意第十角色 | 文档尚不存在，ENOENT |
| payload 与回滚封闭集合 | `sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts` | 三个必填字段与三个回滚终态分别构成封闭集合 | 文档尚不存在，ENOENT |
