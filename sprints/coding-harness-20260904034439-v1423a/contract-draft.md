# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面）

N/A — 任务无 HTTP 响应；本 Sprint 只新增说明文档，不改变端点。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 路由同时注册 `/attempt-run` 与 `/attempt-run/:attemptId`。
- `[累积FR]` 本 line 暂无历史。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页 attempt-run 中文说明，覆盖端点鉴权、九角色、payload/基线与失败回滚。 |
| NFR（做得多好） | 原始标识逐字准确；四节可定位；交付文件唯一。 |
| Invariant（永不违反） | 不改代码；不改变服务端签发分支或权威 Brain 地址语义。 |
| 判定点（怎么知道） | 由冻结 Vitest 从文档章节提取并断言封闭集合。 |
| 保质期（何时过期） | 服务端端点契约变化时由对应代码变更维护者同步修订。 |
| 死亡告警（停了谁知道） | 文档契约测试在 Sprint Tests 中失败并阻塞合并。 |
| 失败语义（挂了怎么办） | 任一断言不满足即非零退出并阻塞，不降级放行。 |
| 效果确认（已发≠已生效） | 从最终 Git 树读取文档，并按冻结基线核对唯一交付文件。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失、字段错误或范围越界 | 测试非零退出并阻塞合并 | 是 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入入口。

gp-anchor: skipped (product-map.json not found)

## 禁 mock 边清单

（本单纯文档改动，无接缝边，N/A）

## 真实调用方请求 shape

N/A — 本单仅记录既有调用契约，不新增或修改设备/agent 请求。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## Golden Path

独立小路（无父路）

[阅读说明] → [创建 attempt] → [查询 attempt] → [理解派发失败回滚]

### Step 1: 找到中文说明并识别创建、查询与鉴权
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1、2 项。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 的「端点与鉴权」节逐字给出两个端点的不同用途、loopback 例外及宿主/远端 Bearer 要求。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t '创建与查询端点及鉴权说明完整'`

**硬阈值**: 命令 exit 0；四个关键字均存在，删去任一个后的负向 oracle 必失败。

### Step 2: 按封闭角色集合与 payload 规则组装创建请求
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 3、4 项。

**可观测行为**: 角色节只提取到九个服务端原始角色；payload 节明确三个必填字段，并明确 `base_sha` 可省略、由生产 Brain 自解析且实现基线不可被 workspace 基线替代。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t '角色白名单是恰好九项的封闭集合|payload 必填字段与 base_sha 规则完整'`

**硬阈值**: 命令 exit 0；角色数组与九项清单全等且去重计数为 9，额外角色与把 `base_sha` 改成必填均被负向 oracle 拒绝。

### Step 3: 查询并理解失败出口
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 5、6 项。

**可观测行为**: 读者能在四个固定章节定位所有信息，并将派发失败理解为三个关联对象全部进入指定终态。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t '派发失败自动回滚的三个终态完整|四个必需章节均存在且不接受同义标题'`

**硬阈值**: 命令 exit 0；三个状态和四个章节全部存在，删除任一状态或改写固定标题均被负向 oracle 拒绝。

### Step 4: 证明交付范围未越界
**来源**: `[AI_ADDED]` — 将 PRD「只交付文档、不改变任何运行时行为」转换为冻结基线上的防造假范围 oracle。

**可观测行为**: 排除 Sprint 合同产物后，相对冻结实现基线的变更清单恰好只有目标说明页。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t '文档为 docs/current 下唯一交付文件且内容为中文'`

**硬阈值**: 命令 exit 0；`git diff --name-only bdaca81b5cbf78929fa3d8eeac2a24cae6113b98 -- . ':(exclude)sprints/**'` 的有序清单严格等于 `docs/current/attempt-run-bridge-guide.md`。

## 断言自洽声明

现场清单共 12 个原子断言，计数为 12：①唯一交付路径正向、②中文负向、③端点鉴权正向、④删关键字负向、⑤九角色全等正向、⑥额外角色负向、⑦ payload/base_sha 正向、⑧ base_sha 必填负向、⑨三终态正向、⑩删终态负向、⑪四标题正向、⑫同义标题负向。两两推演为 (①,②)、(③,④)、(⑤,⑥)、(⑦,⑧)、(⑨,⑩)、(⑪,⑫)：每对的正向接受完整目标，负向只破坏该目标并必须被拒绝；各对读取范围互不覆盖，范围 oracle 排除 `sprints/**`，因此 12 个断言无互斥结论。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查端点、角色、字段和状态是否存在近似但错误的拼写。
- 重复提交: 检查同一角色或章节重复后封闭集合是否失败。
- 中途中断: N/A — 静态文档无运行中状态。
- 边界值: 检查角色恰好九项、交付文件恰好一页。
发现分级: P0/P1（错误指导远端调用或越界改代码）阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=bdaca81b5cbf78929fa3d8eeac2a24cae6113b98
DOC=docs/current/attempt-run-bridge-guide.md
CHANGED=$(git diff --name-only "$BASE_SHA" -- . ':(exclude)sprints/**')
[ "$CHANGED" = "$DOC" ] || { echo "FAIL: 交付范围不等于唯一文档: $CHANGED"; exit 1; }
npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 文档完整性与范围 | `sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts` | 文档为 docs/current 下唯一交付文件且内容为中文；创建与查询端点及鉴权说明完整；角色白名单是恰好九项的封闭集合；payload 必填字段与 base_sha 规则完整；派发失败自动回滚的三个终态完整；四个必需章节均存在且不接受同义标题 | 目标文档尚不存在，6 tests failed |

## Notes

contract-gate: 使用 Cecelia 仓内 `packages/brain/src/lib/contract-gate.js`。

