# Sprint Contract Draft (Round 3)

## Response Schema（推导来源: PRD字面）

N/A — 本任务只新增说明文档，不改变 HTTP 响应。

## 已知约束

- [sprint-prd.md / Invariant] 两个端点均须说明鉴权，且不得写入真实凭据。
- [sprint-prd.md / 范围限定] 仅新增 `docs/current/attempt-run-bridge-guide.md`，不修改代码。
- [累积FR] 本 line 暂无历史。
- [MAP_NOT_CONFIGURED] task payload 未配置 map_scope/map_repo；无 must_run_assertions。

gp-anchor: skipped (product-map.json not found)

## Golden Path

独立小路（无父路）

[阅读说明] → [按说明创建运行] → [按 id 查询] → [识别派发失败回滚终态]

### Step 1: 找到两个 attempt-run 端点及其用途
**来源**: `[FROM_PRD]` — thin_prd 第 1 项。
**可观测行为**: 文档分别出现创建派发端点与按 id 查询端点，并解释用途；不得交换两个端点的用途。
**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t '端点用途逐项正向并拒绝反向描述'`
**硬阈值**: POST 与 GET 字面值各对应正确用途，交换或遗漏时测试失败；命令 exit 0。

### Step 2: 按受保护方式鉴权
**来源**: `[FROM_PRD]` — thin_prd 第 1 项。
**可观测行为**: 文档说明 `internalAuthOrLoopback`；宿主与远端必须携带 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`；匿名、错误 token 或真实凭据不得被写成合法示例。
**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t '鉴权逐项正向并拒绝匿名错误 token 与真实凭据'`
**硬阈值**: 三个鉴权约束全出现，危险反向表述与疑似真实 Bearer 值均为零；命令 exit 0。

### Step 3: 选择合法角色
**来源**: `[FROM_PRD]` — thin_prd 第 2 项。
**可观测行为**: 角色清单逐项且恰好为 `planner`、`proposer`、`critic`、`generator`、`generator-fix`、`evaluator`、`evaluator-fix`、`merger`、`reporter`。
**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t '角色白名单九项逐项正向并拒绝重复遗漏与额外项'`
**硬阈值**: 清单长度为 9、顺序与集合严格相等、无重复和额外项；命令 exit 0。

### Step 4: 构造 payload
**来源**: `[FROM_PRD]` — thin_prd 第 3 项。
**可观测行为**: 文档把 `sprint_dir`、`base_repo`、`branch` 逐项标为必填，把 `base_sha` 标为可省略且由生产 Brain 自解析。
**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t 'payload 每个字段逐项正向并拒绝 base_sha 必填语义'`
**硬阈值**: 三项必填逐项存在，任一遗漏即失败；`base_sha` 不得归入必填或被描述为缺失报错；命令 exit 0。

### Step 5: 识别派发失败回滚结果
**来源**: `[FROM_PRD]` — thin_prd 第 4 项。
**可观测行为**: 文档逐项说明 `run → failed`、`session → closed`、`task → cancelled`，并拒绝把运行中 session 或待执行 task 描述为失败后的残留状态。
**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t '回滚三状态逐项正向并拒绝非终态残留'`
**硬阈值**: 三个映射逐项精确出现，错误终态组合为零；命令 exit 0。

### Step 6: 证明变更范围只含说明页
**来源**: `[AI_ADDED]` — 将 PRD“不改任何代码”转换为基于冻结实现基线的 canonical diff oracle。
**可观测行为**: 候选提交相对 `48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3` 仅新增目标说明页。
**验证命令**: `test "$(git diff --name-only 48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3...HEAD | grep -v '^sprints/coding-harness-20260902104452-b4swl3/')" = 'docs/current/attempt-run-bridge-guide.md'`
**硬阈值**: canonical diff 路径集合严格等于目标文档，出现额外路径或缺少目标路径均失败。

## 真实调用方请求 shape

N/A — 本 Sprint 只记录 frozen PRD 已冻结的调用契约，不新增或修改调用方。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 接缝清单

（本单无运行时接缝；文档准确性由冻结 Vitest 合同与 canonical diff 机械验收。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接说明，覆盖端点、鉴权、九角色、payload 与回滚。 |
| NFR（做得多好） | 四节独立组织；关键字面值可机械匹配；只新增目标文档。 |
| Invariant（永不违反） | 不泄露 token；不把匿名或错 token 写成可访问；不修改代码。 |
| 判定点（怎么知道） | 由冻结 Vitest 测试解析标题、列表和字面契约。 |
| 保质期（何时过期） | 当生产端点契约改变时由该契约变更的维护者同步更新。 |
| 死亡告警（停了谁知道） | Sprint Tests 失败即由 required CI 报告。 |
| 失败语义（挂了怎么办） | 任一正向或负向 oracle 失败均阻塞交付，不降级。 |
| 效果确认（已发≠已生效） | 文档测试通过且 canonical diff 仅含目标页才算生效。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺项或出现反向误导 | 测试非零退出并阻塞交付 | 是 | 无降级 |
| diff 出现目标页外路径 | 范围 oracle 非零退出并阻塞交付 | 是 | 无降级 |

### 输入对抗面

N/A — 不新增对外 agent 或可写接口。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查匿名、错 Bearer、非白名单角色是否被误写为合法。
- 重复提交: 检查九项角色是否重复列项或藏有第十项。
- 中途中断: N/A，静态文档无异步流程。
- 边界值: 检查省略 `base_sha` 是否仍明确为合法。
发现分级: P0/P1（凭据泄露或直接误导调用方）阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web（静态文档在仓库工作区验收，不涉及 UI）

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3
DOC=docs/current/attempt-run-bridge-guide.md
test -f "$DOC"
npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts
CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD | grep -v '^sprints/coding-harness-20260902104452-b4swl3/')
[ "$CHANGED" = "$DOC" ] || { echo "FAIL: 变更范围=$CHANGED"; exit 1; }
git diff --diff-filter=A --name-only "$BASE_SHA"...HEAD | grep -Fx "$DOC"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 桥接说明完整性与反向误导防护 | `sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts` | `端点用途逐项正向并拒绝反向描述`、`鉴权逐项正向并拒绝匿名错误 token 与真实凭据`、`角色白名单九项逐项正向并拒绝重复遗漏与额外项`、`payload 每个字段逐项正向并拒绝 base_sha 必填语义`、`回滚三状态逐项正向并拒绝非终态残留` | 目标文档不存在，读取文件失败并产生至少 1 个 failure |

## notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- 实现基线固定为 `48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3`；角色 checkout SHA 不得替换该值。
