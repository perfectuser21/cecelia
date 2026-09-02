# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A）

N/A — 本任务只新增说明文档，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试与历史约束）

- [PRD/端点鉴权] 两个端点均须说明 `internalAuthOrLoopback`；宿主/远端必须使用 Bearer token。
- [PRD/凭据安全] 只展示 `$CECELIA_INTERNAL_TOKEN` 占位符，不写真实 token。
- [PRD/Planner 分支] 本合同保持服务端签发分支；该约束不进入实现范围。
- [累积 FR] 本 line 暂无历史；journey_id 为 none，context-manifest 不适用。
- [现有回归] `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` 锁定九角色封闭集合及两个路由。
- [MAP_NOT_CONFIGURED] task 未提供 map_scope/map_repo，无 must_run_assertions、fact_revisions 或 freshness 可注入。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增 `docs/current/attempt-run-bridge-guide.md` 中文说明，覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 四节独立、字面可机检；实现 diff 仅一页文档。 |
| Invariant（永不违反） | 不泄露 token；不把 `base_sha` 写成必填；不修改代码。 |
| 判定点（怎么知道） | 以独立章节、封闭集合及正负 oracle 判定。 |
| 保质期（何时过期） | 路由契约变化时由路由维护者同步更新。 |
| 死亡告警（停了谁知道） | Sprint Tests 在文档缺失或契约漂移时阻塞 CI。 |
| 失败语义（挂了怎么办） | 任一章节或字面约束失败即拒绝交付，不部分放行。 |
| 效果确认（已发≠已生效） | 读取候选提交树文档，并相对冻结基线核对唯一实现 diff。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或内容漂移 | 测试非零退出 | 是 | 不降级 |
| 出现疑似真实 Bearer token | 测试失败 | 是 | 只允许环境变量占位符 |
| 目标文档外有实现变更 | 范围 oracle 失败 | 是 | 删除越界变更 |

### 输入对抗面

N/A — 不新增外部 agent 或输入入口。

gp-anchor: skipped (product-map.json not found)

## 禁 mock 边清单

（本单纯文档改动，无接缝边，N/A。）

## 真实调用方请求 shape

N/A — 本 sprint 不发请求；说明中的宿主/远端鉴权 shape 固定为 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## Golden Path

独立小路（无父路）

[打开说明] → [确认端点与鉴权] → [核对角色与 payload] → [理解失败回滚]

### Step 1: 找到两个端点及鉴权说明
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1、2 项。

**可观测行为**: 中文说明解释 POST 创建并派发、GET 按 id 查询；宿主/远端必须携带 Bearer token。

**硬阈值**: 两个端点、`internalAuthOrLoopback`、Bearer 环境变量全部出现；匿名远端与硬编码 token 均不得出现。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "包含两个端点用途与鉴权要求，并拒绝匿名远端表述"`

### Step 2: 核对封闭角色白名单
**来源**: `[FROM_PRD]` — PRD 假设要求与权威接口契约核对；以 `ALLOWED_ROLES` 当前实现为准。

**可观测行为**: 文档仅逐行列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`。

**硬阈值**: 集合长度与去重后长度均为 9，顺序和值完全相等；`critic`、`evaluator-fix`、`merger`、`reporter` 不得列入。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "包含且仅声明权威实现的九项角色白名单，并排除白名单外角色"`

### Step 3: 区分 payload 必填与可省略字段
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项。

**可观测行为**: `sprint_dir`、`base_repo`、`branch` 标为必填；`base_sha` 标为可省略并由生产 Brain 自解析。

**硬阈值**: 三个必填字段逐项出现；`base_sha` 不得被描述为必填。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "包含 payload 必填字段与 base_sha 省略语义，并拒绝错误必填表述"`

### Step 4: 识别派发失败完整回滚
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 项。

**可观测行为**: 同一章节列出 `run→failed`、`session→closed`、`task→cancelled`，并说明不得残留运行中 session 或待执行 task。

**硬阈值**: 三项终态全部出现；失败语义不得指向 running、active 或 queued。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "包含派发失败的三类回滚终态，并排除活跃残留"`

### Step 5: 锁定唯一实现范围
**来源**: `[AI_ADDED]` — 将 PRD「仅新增一页中文说明、不改代码」转换为候选树范围 oracle。

**可观测行为**: 排除本 sprint 冻结合同产物后，相对权威实现基线仅新增目标文档。

**硬阈值**: 实现文件集合严格等于 `docs/current/attempt-run-bridge-guide.md`，无第二项。

**验证命令**: `bash -c 'BASE_SHA=48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3; mapfile -t implementation_files < <(git diff --name-only "$BASE_SHA"...HEAD | grep -v "^sprints/coding-harness-20260902104452-b4swl3/"); [ "${#implementation_files[@]}" -eq 1 ]; [ "${implementation_files[0]}" = "docs/current/attempt-run-bridge-guide.md" ]'`

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
DOC=docs/current/attempt-run-bridge-guide.md
BASE_SHA=48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3
test -f "$DOC"
npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts
mapfile -t implementation_files < <(git diff --name-only "$BASE_SHA"...HEAD | grep -v '^sprints/coding-harness-20260902104452-b4swl3/')
[ "${#implementation_files[@]}" -eq 1 ]
[ "${implementation_files[0]}" = "$DOC" ]
echo 'attempt-run 桥接使用说明验收通过'
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否把 `base_sha` 误写成必填，或暗示匿名远端可访问。
- 重复提交: 检查九角色是否重复、遗漏或混入第十项。
- 中途中断: N/A，静态文档无运行中状态。
- 边界值: 检查 loopback、宿主、远端三种位置的鉴权表述是否无歧义。
发现分级: P0/P1（凭据泄露或错误生产指导）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts` | `包含两个端点用途与鉴权要求，并拒绝匿名远端表述`、`包含且仅声明权威实现的九项角色白名单，并排除白名单外角色`、`包含 payload 必填字段与 base_sha 省略语义，并拒绝错误必填表述`、`包含派发失败的三类回滚终态，并排除活跃残留` | 目标文档尚不存在，四项均因 ENOENT 失败 |

## Notes

- contract-gate: applicable (`packages/brain/src/lib/contract-gate.js` exists)
- implementation baseline: `48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3`（跨角色与 GAN 轮次保持不变）
