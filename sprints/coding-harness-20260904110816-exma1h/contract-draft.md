# Sprint Contract Draft (Round 1)

task_request_hash: `0207fb013c7d30227edea6e345a287b4561ac99dd9406c7b38d5501d1b078d37`

## Response Schema（推导来源: PRD字面）

N/A — 任务只新增说明文档，无 HTTP 响应或运行时行为变更。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 角色白名单封闭：九个角色且不含 commander/publisher。
- `[累积FR]` 本 line 暂无历史。
- Unified Map: `[MAP_NOT_CONFIGURED]`（task payload 未提供可用的 scope/repo 字符串，must_run_assertions 为空）。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文说明，准确覆盖两个端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 精确字面量、封闭集合对账；只新增一页 Markdown。 |
| Invariant（永不违反） | 不改代码；不把非回环匿名请求描述为可访问；不扩充角色或字段默认值。 |
| 判定点（怎么知道） | 用冻结 Vitest 解析章节与生产 `ALLOWED_ROLES` 精确同集。 |
| 保质期（何时过期） | 生产端点契约变化时由对应代码变更维护者同步更新文档。 |
| 死亡告警（停了谁知道） | 文档与生产角色集合漂移时 Sprint Tests 立即失败。 |
| 失败语义（挂了怎么办） | 缺节、错字面量、集合漂移或超范围差异均阻塞交付。 |
| 效果确认（已发≠已生效） | 对候选 git diff 和文档正文执行冻结测试，全部断言通过才生效。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺项或与生产白名单漂移 | 测试非零退出并阻塞交付 | 是 | 不降级，修正文档 |
| 候选含文档外变更 | 测试非零退出并阻塞交付 | 是 | 不降级，恢复冻结范围 |

### 输入对抗面

N/A — 不对外暴露 agent 或新增输入面。

gp-anchor: skipped (product-map.json not found)

## Golden Path

独立小路（无父路）

[阅读说明] → [确认端点与鉴权] → [选择合法角色并构造 payload] → [查询并辨认派发或回滚终态]

### Step 1: 找到唯一中文使用说明
**来源**: `[FROM_PRD]` — “范围限定”要求仅在 `docs/current/` 新增一页中文 Markdown。

**可观测行为**: 候选相对冻结实现基线只新增 `docs/current/attempt-run-bridge-usage.md`，并包含四节。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-doc.test.ts -t "文档范围、中文四节与 task_request_hash 绑定"`

**硬阈值**: 变更文件数=1、状态=A、中文字符数≥1、独立章节数=4；由上述命令逐项断言。

### Step 2: 按正确鉴权调用创建与查询端点
**来源**: `[FROM_PRD]` — Golden Path 第 1-2 项。

**可观测行为**: 文档准确区分 POST 创建派发与 GET 按 id 查询，并说明 `internalAuthOrLoopback`、回环差异及宿主/远端 Bearer 要求。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-doc.test.ts -t "端点用途与鉴权精确且拒绝远端匿名表述"`

**硬阈值**: 四个精确字面量全部出现；远端“无需 token”表述数=0；由上述命令断言。

### Step 3: 从封闭角色集合构造 payload
**来源**: `[FROM_PRD]` — Golden Path 第 3-4 项。

**可观测行为**: 角色清单先解析为九项无重复数组，再与生产 `ALLOWED_ROLES` 排序后精确比较；payload 三项必填，只有 `base_sha` 可省略并由生产 Brain 自解析。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-doc.test.ts -t "角色白名单恰好九项并与生产权威集合精确相等|payload 必填性与三对象回滚终态完整且无反向歧义"`

**硬阈值**: 清单长度=9、去重长度=9、集合差=0；三必填字段反向可省略命中数=0；由上述命令断言。

### Step 4: 辨认派发失败后的完整回滚
**来源**: `[FROM_PRD]` — Golden Path 第 5-6 项。

**可观测行为**: 文档同时给出 `run → failed`、`session → closed`、`task → cancelled`，不出现相反终态。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-doc.test.ts -t "payload 必填性与三对象回滚终态完整且无反向歧义"`

**硬阈值**: 三组映射命中数=3、反向映射命中数=0；由上述命令断言。

## 真实调用方请求 shape

N/A — 本 sprint 只写现有接口说明，不改变调用方或请求协议；文档中的请求字段严格来自 PRD。

## 禁 mock 边清单

（本单纯文档改动，无调度、状态机、跨模块、生命周期或 DB 写路径变更，N/A）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 接缝清单

无运行时接缝；所有验收均为候选树与生产源码之间的确定性只读核验。

## 断言自洽声明

- 范围正向“恰好新增目标文档”与负向“任何额外文件均失败”共享同一 `git diff --name-status` 集合，不能同时误放宽。
- 鉴权正向精确字面量与负向远端免 token 禁句相容：要求宿主/远端必须带 token，不否定未配置 token 时开发回环的限定例外。
- 角色正向先验证九项无重复，再精确同集；负向排除别名，不会以重复项或子集凑数。
- payload 正向锁定三必填与一可省略，负向禁止把三必填描述成选填；两者无交集。
- 回滚正向要求三映射齐全，负向排除相反终态；全部断言两两推演无矛盾。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 文档中出现近似但错误的端点、角色或字段拼写。
- 重复提交: 同一角色重复两次，表面仍有九行。
- 中途中断: 只写 run 回滚而遗漏 session/task。
- 边界值: 文档额外新增第十个角色或把 `base_sha` 写成必填。
发现分级: P0/P1（错误派发或鉴权误导）阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=e0a56e2efaa96a5e9b1759f6b1086282121454dd
EXPECTED=$'A\tdocs/current/attempt-run-bridge-usage.md'
ACTUAL=$(git diff --name-status "$BASE_SHA" HEAD)
[ "$ACTUAL" = "$EXPECTED" ] || { echo "FAIL: 冻结范围不符: $ACTUAL"; exit 1; }
npx vitest run --no-cache sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-doc.test.ts
```

## Test Contract

task_request_hash: `0207fb013c7d30227edea6e345a287b4561ac99dd9406c7b38d5501d1b078d37`

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 冻结范围与章节 | `sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-doc.test.ts` | 文档范围、中文四节与 task_request_hash 绑定 | 目标文档尚不存在，测试失败 |
| 端点与鉴权 | `sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-doc.test.ts` | 端点用途与鉴权精确且拒绝远端匿名表述 | 目标文档尚不存在，测试失败 |
| 九角色封闭集合 | `sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-doc.test.ts` | 角色白名单恰好九项并与生产权威集合精确相等 | 目标文档尚不存在，测试失败 |
| payload 与回滚 | `sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-doc.test.ts` | payload 必填性与三对象回滚终态完整且无反向歧义 | 目标文档尚不存在，测试失败 |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- canonical diff baseline 固定为实现基线 `e0a56e2efaa96a5e9b1759f6b1086282121454dd`，不得以角色 checkout SHA 替代。
