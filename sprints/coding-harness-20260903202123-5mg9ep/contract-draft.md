# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A）

N/A — 本任务仅新增说明文档，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → attempt-run 路由与九项角色白名单已有代码级约束。
- `packages/brain/src/middleware/internal-auth.test.js` → `internalAuthOrLoopback` 区分 loopback 与远端 Bearer 鉴权。
- [累积FR] 本 line 暂无历史。
- [MAP_NOT_CONFIGURED] task payload 未提供可用的 map_scope/map_repo，故无 must_run_assertions；未回退到领域硬编码。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/` 新增一页中文说明，覆盖两个端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 枚举使用恰好 N 项封闭集合；每个正向 oracle 都有负向 oracle；生产范围仅一份文档。 |
| Invariant（永不违反） | 不改实现代码；不泄露密钥；固定使用 implementation baseline。 |
| 判定点（怎么知道） | N/A：全部是可逐字断言的既有合同，无模糊现实判断。 |
| 保质期（何时过期） | attempt-run 路由合同变化时由变更者同步更新文档和冻结测试。 |
| 死亡告警（停了谁知道） | Sprint Tests 或范围 oracle 在 CI 当次失败。 |
| 失败语义（挂了怎么办） | 任一章节、封闭集合、负向语义或范围断言失败即阻塞交付。 |
| 效果确认（已发≠已生效） | 从候选 HEAD 读取目标页，运行冻结 Vitest 与基线 diff 双重确认。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺项、枚举不封闭或负向语义命中 | 测试非零退出并阻塞合并 | 是 | 不降级 |
| 候选含额外生产文件 | 范围 oracle 非零退出并阻塞合并 | 是 | 不降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入接口。

gp-anchor: skipped (product-map.json not found)

## Golden Path

独立小路（无父路）

[阅读说明] → [选择端点并鉴权] → [选择角色并构造 payload] → [查询结果或识别失败回滚]

### Step 1: 识别创建与查询入口及鉴权边界
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1、2 步。

**可观测行为**: 文档分别说明 POST 创建/派发、GET 按 id 查询/轮询，并逐字说明 `internalAuthOrLoopback` 和宿主/远端 Bearer 要求。

**验证命令**: `npx vitest run sprints/coding-harness-20260903202123-5mg9ep/tests/attempt-run-bridge-guide.test.ts -t '两个端点用途与 Bearer 鉴权正反边界'`

**硬阈值**: 两端点用途与两类鉴权边界全部命中；远端免鉴权和形似真实 token 均零命中；由上述命令 exit 0 机检。

### Step 2: 从封闭集合选择执行角色
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步。

**可观测行为**: 九项角色以独立条目固定列出，白名单外角色明确拒绝。

**验证命令**: `npx vitest run sprints/coding-harness-20260903202123-5mg9ep/tests/attempt-run-bridge-guide.test.ts -t '角色白名单恰好九项且拒绝白名单外角色'`

**硬阈值**: 角色集合恰好 9 项且逐项相等；重复项、commander、publisher 均不通过；由上述命令 exit 0 机检。

### Step 3: 构造最小 payload
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步与「边界情况」。

**可观测行为**: 文档把 `sprint_dir`、`base_repo`、`branch` 列为唯一三个必填字段，并说明 `base_sha` 可省略、由生产 Brain 自解析。

**验证命令**: `npx vitest run sprints/coding-harness-20260903202123-5mg9ep/tests/attempt-run-bridge-guide.test.ts -t 'payload 必填集合恰好三项且 base_sha 可省略'`

**硬阈值**: 必填集合恰好 3 项；`base_sha` 必填或调用方固定/解析语义零命中；由上述命令 exit 0 机检。

### Step 4: 识别派发失败后的完整回滚
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 步。

**可观测行为**: 文档以封闭集合列出 run、session、task 的目标终态。

**验证命令**: `npx vitest run sprints/coding-harness-20260903202123-5mg9ep/tests/attempt-run-bridge-guide.test.ts -t '派发失败回滚三项终态完整且没有错误终态'`

**硬阈值**: 转移集合恰为 `run→failed`、`session→closed`、`task→cancelled`；成功/活跃终态及“部分成功”零命中；由上述命令 exit 0 机检。

### Step 5: 锁定纯文档生产范围
**来源**: `[AI_ADDED]` — 将 PRD“不改任何代码”转换为无法由额外文件绕过的冻结基线 diff oracle。

**可观测行为**: 候选相对冻结 implementation baseline 的生产路径只新增目标文档。

**验证命令**: `BASE_SHA=71ba943ed858735e77059927fc4c2cdc25022c9e; DOC=docs/current/attempt-run-bridge.md; mapfile -t F < <(git diff --name-only --diff-filter=ACMRT "$BASE_SHA"...HEAD -- docs/current packages apps scripts tests playground); [ "${#F[@]}" -eq 1 ] && [ "${F[0]}" = "$DOC" ] && ! git diff --name-only --diff-filter=ACMRT "$BASE_SHA"...HEAD -- packages apps scripts tests playground | grep -q .`

**硬阈值**: 生产路径变更集合恰好 1 项且等于目标文档，代码路径变更集合恰好 0 项；由上述命令 exit 0 机检。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块数据传递、生命周期钩子或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 本 sprint 只说明既有接口，不修改设备/agent 调服务端的请求 shape。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（纯文档交付，无真实世界接缝，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例是否误把 `base_sha` 写成必填。
- 重复提交: N/A，文档无提交入口。
- 中途中断: N/A，文档无运行时状态。
- 边界值: 检查九项角色及三项必填字段是否重复、遗漏或混入别名。
发现分级: P0/P1（泄密或误导远端匿名访问）阻塞 merge；P2/P3 记 findings。

## E2E 验收

**journey_type**: dev_pipeline
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA="71ba943ed858735e77059927fc4c2cdc25022c9e"
DOC="docs/current/attempt-run-bridge.md"
test -f "$DOC"
npx vitest run sprints/coding-harness-20260903202123-5mg9ep/tests/attempt-run-bridge-guide.test.ts
mapfile -t CHANGED < <(git diff --name-only --diff-filter=ACMRT "$BASE_SHA"...HEAD -- docs/current packages apps scripts tests playground)
[ "${#CHANGED[@]}" -eq 1 ]
[ "${CHANGED[0]}" = "$DOC" ]
if git diff --name-only --diff-filter=ACMRT "$BASE_SHA"...HEAD -- packages apps scripts tests playground | grep -q .; then
  echo 'FAIL: 检出实现代码或测试运行逻辑变化'
  exit 1
fi
echo 'OK: attempt-run 桥接说明与范围验收通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260903202123-5mg9ep/tests/attempt-run-bridge-guide.test.ts` | 两个端点用途与 Bearer 鉴权正反边界；角色白名单恰好九项且拒绝白名单外角色；payload 必填集合恰好三项且 base_sha 可省略；派发失败回滚三项终态完整且没有错误终态 | 目标文档尚不存在，4 个测试均因 ENOENT 失败 |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- implementation baseline 固定为 `71ba943ed858735e77059927fc4c2cdc25022c9e`；workspace checkout SHA 不替换该基线。
