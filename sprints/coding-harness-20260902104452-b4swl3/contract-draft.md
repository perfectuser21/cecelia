# Sprint Contract Draft (Round 1)

task_request_hash: `36b99953756db7fbbaa29fd6871c56a549f04acbec458352388564d4538b039`

## Response Schema（推导来源: N/A）

N/A — 本任务只新增说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → 角色白名单封闭：包含九个执行角色，永不包含 commander/publisher。
- [packages/brain/src/middleware/internal-auth.test.js] → `internalAuthOrLoopback` 的 loopback 与 Bearer 鉴权边界必须保持不变。
- [累积FR] 本 line 暂无历史。
- Unified Map: `[MAP_NOT_CONFIGURED]`；无 `must_run_assertions`、`fact_revisions` 或 `freshness` 可引入。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-bridge-guide.md` 新增中文说明，覆盖端点与鉴权、九项角色、payload、失败回滚。 |
| NFR（做得多好） | 四个二级章节；关键字面量可机械核对；不泄露真实 token。 |
| Invariant（永不违反） | 不改代码；不写真实凭据；不改变 Planner 分支规则。 |
| 判定点（怎么知道） | 由冻结 Vitest 与 E2E 对正文和差异闭集逐项断言。 |
| 保质期（何时过期） | 路由契约变化时由修改者同步更新本页；此前持续有效。 |
| 死亡告警（停了谁知道） | 文档测试在 required CI 失败并阻塞合并。 |
| 失败语义（挂了怎么办） | 任一正文或范围断言失败即阻塞，不降级放行。 |
| 效果确认（已发≠已生效） | 从 Git HEAD 读取文档，并逐项核对闭集与负向样例。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺项、集合多项或少项 | 测试非零退出并阻塞合并 | 是 | 无降级 |
| 实现 diff 越界 | 测试非零退出并列出越界路径 | 是 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入入口。

## Golden Path

独立小路（无父路）

[读说明] → [确认端点与鉴权] → [选择合法角色与 payload] → [查询结果或识别回滚终态]

### Step 1: 读者确认两个桥接端点及鉴权
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1、2 项。

**可观测行为**: 第一节逐字列出 POST 创建派发、GET 按 id 查询、`internalAuthOrLoopback` 与远端 Bearer 占位符，并明确匿名或错误 token 不可访问。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t '端点与鉴权正负 oracle'
```

**硬阈值**: 两个端点、鉴权名和安全占位符全部命中；真实 token 与“匿名可访问”均不得出现；命令 exit 0。

### Step 2: 读者从封闭白名单选择角色
**来源**: `[FROM_PRD]` — PRD 假设要求以权威接口契约核对九项拼写；权威 `ALLOWED_ROLES` 当前为 canary、planner、proposer、reviewer、generator、generator-fix、evaluator、evaluator-evidence-repair、judge。

**可观测行为**: 第二节用恰好九项的清单完整列名，且不把 PRD 初始假设中的旧角色或其他字符串描述为合法角色。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t '角色白名单封闭集合正负 oracle'
```

**硬阈值**: 集合与生产 `ALLOWED_ROLES` 逐项相等、长度为 9；`critic`、`merger`、`reporter`、`publisher`、`commander` 均不在白名单；命令 exit 0。

### Step 3: 读者构造 payload
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 4 项。

**可观测行为**: 第三节逐项列出 `sprint_dir`、`base_repo`、`branch` 三个必填字段，并将 `base_sha` 单独标为可省略、由生产 Brain 自解析。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t 'payload 必填闭集与 base_sha 负向 oracle'
```

**硬阈值**: 必填集合恰为三项；`base_sha` 不得出现在必填清单且正文必须明确可省略；命令 exit 0。

### Step 4: 读者识别派发失败的完整回滚
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 5 项与「边界情况」。

**可观测行为**: 第四节逐项列出 `run → failed`、`session → closed`、`task → cancelled`，说明可用 GET 查询，且否定残留活跃 session 或待执行 task。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t '失败回滚封闭集合正负 oracle'
```

**硬阈值**: 三个且仅三个回滚映射逐项相等；不得声称 session 保持 active 或 task 保持 queued；命令 exit 0。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 真实调用方请求 shape

N/A — 仅记录既有端点用法，不新增或改动设备/agent 调用链。

gp-anchor: skipped (product-map.json not found)

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例是否误把 `base_sha` 写成必填。
- 重复提交: 对九项角色去重后仍必须恰为九项。
- 中途中断: N/A，静态文档无异步流程。
- 边界值: 搜索近似角色名、额外角色名和真实 token 痕迹。
发现分级: P0/P1（凭据泄露或契约误导）阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web（工作区静态文档验收，不启动 UI）

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3
SPRINT_DIR=sprints/coding-harness-20260902104452-b4swl3
DOC=docs/current/attempt-run-bridge-guide.md
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts"

# coding-contract canonical 范围 oracle：固定冻结基线，三点 diff，先取全集再排除冻结合同产物。
mapfile -t CHANGED < <(git diff --name-only "$BASE_SHA"...HEAD)
mapfile -t IMPLEMENTATION_CHANGED < <(printf '%s\n' "${CHANGED[@]}" | grep -vE "^${SPRINT_DIR}/(contract-draft\.md|contract-dod\.md|task-plan\.json|tests/.*\.test\.ts)$" || true)
[ "${#IMPLEMENTATION_CHANGED[@]}" -eq 1 ]
[ "${IMPLEMENTATION_CHANGED[0]}" = "$DOC" ]
git diff --diff-filter=A --name-only "$BASE_SHA"...HEAD -- "$DOC" | grep -Fxq "$DOC"
git diff --name-only "$BASE_SHA"...HEAD | grep -Eq '\.(js|cjs|mjs|ts|tsx|jsx|py|sh)$' && { echo 'FAIL: 不得修改代码'; exit 1; } || true
echo 'OK: 文档内容与范围合同通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明全文 | `sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts` | 端点与鉴权正负 oracle；角色白名单封闭集合正负 oracle；payload 必填闭集与 base_sha 负向 oracle；失败回滚封闭集合正负 oracle；交付范围 canonical diff 正负 oracle | 目标文档尚不存在，至少 5 个用例失败 |

## Notes

- 实现基线固定为 `48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3`；不得以角色 checkout 的其他 SHA 替换。
- contract-gate: 使用 Cecelia 仓现有 gate；本合同同时遵守 skill 内置规则。
