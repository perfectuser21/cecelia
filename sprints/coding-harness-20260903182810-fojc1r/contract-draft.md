# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A）

N/A — 任务仅新增说明文档，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 角色白名单封闭，包含九个执行角色且不含 commander/publisher。
- `packages/brain/src/middleware/internal-auth.test.js` → `internalAuthOrLoopback` 区分 loopback 与远端鉴权。
- [累积FR] 本 line 暂无历史。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/` 新增一页中文 attempt-run 桥接说明，覆盖端点、鉴权、角色、payload 与回滚。 |
| NFR（做得多好） | 名称逐字可断言；不得泄露凭据；生产变更仅一份文档。 |
| Invariant（永不违反） | 不改代码；不写真实 token；不暗示远端可匿名访问。 |
| 判定点（怎么知道） | N/A，文档枚举与生产源码逐字比对，无模糊现实判断。 |
| 保质期（何时过期） | 路由或白名单变更时由其代码评审者同步更新文档。 |
| 死亡告警（停了谁知道） | 冻结测试与范围 oracle 在 CI 当次失败。 |
| 失败语义（挂了怎么办） | 任一枚举、语义或范围断言不满足即阻塞交付。 |
| 效果确认（已发≠已生效） | 从冻结基线读取新增页并逐字断言全部四节。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺项或枚举漂移 | 测试非零退出并阻塞合并 | 是 | 不降级 |
| 范围出现额外文件 | 范围 oracle 非零退出并阻塞合并 | 是 | 不降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入接口。

gp-anchor: skipped (product-map.json not found)

## Golden Path

独立小路（无父路）

[打开说明页] → [按说明创建 attempt] → [按 id 查询状态] → [识别失败回滚终态]

### Step 1: 找到创建与查询入口及鉴权边界
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1、2 步。

**可观测行为**: 中文说明逐字给出 POST、GET、`internalAuthOrLoopback`，并说明宿主/远端必须携带 Bearer 占位符且不可匿名。

**验证命令**: `npx vitest run sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-usage-doc.test.ts -t '文档包含两个端点及远端 Bearer 鉴权的正反边界'`

**硬阈值**: 两端点与三项鉴权文字全部命中，匿名正向暗示零命中；由上述命令 exit 0 机检。

### Step 2: 选择合法角色
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步。

**可观测行为**: 九个角色以九个独立条目、固定顺序列出，集合与生产 `ALLOWED_ROLES` 完全相等，禁用别名不出现。

**验证命令**: `npx vitest run sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-usage-doc.test.ts -t '角色白名单封闭且逐项等于九个生产角色'`

**硬阈值**: 封闭集合恰为 9 项且 commander/publisher 均不在集合；由上述命令 exit 0 机检。

### Step 3: 构造最小 payload
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 步。

**可观测行为**: 文档明确三个必填字段及 `base_sha` 可省略、由生产 Brain 自解析的语义，同时拒绝固定值或调用方猜测的说法。

**验证命令**: `npx vitest run sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-usage-doc.test.ts -t '最小 payload 只要求三个字段并明确 base_sha 省略语义'`

**硬阈值**: 三个必填字段全出现且错误语义零命中；由上述命令 exit 0 机检。

### Step 4: 识别派发失败后的终态
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5、6 步。

**可观测行为**: 文档逐项列出 run、session、task 的三个回滚终态，不把失败描述为部分成功。

**验证命令**: `npx vitest run sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-usage-doc.test.ts -t '派发失败回滚完整列出三个资源终态且不称为部分成功'`

**硬阈值**: 三项终态全部命中且“部分成功”零命中；由上述命令 exit 0 机检。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 本 sprint 只记录既有接口，不新增或修改设备/agent 调服务端的请求 shape。

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
- 边界值: 检查九项角色是否有重复、别名或遗漏。
发现分级: P0/P1（泄密或误导远端匿名访问）阻塞 merge；P2/P3 记 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA="565796b924487f6d5c4314703c757b32b788fdac"
DOC="docs/current/attempt-run-bridge-usage.md"
test -f "$DOC"
npx vitest run sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-usage-doc.test.ts
mapfile -t CHANGED < <(git diff --name-only --diff-filter=ACMRT "$BASE_SHA"...HEAD -- docs/current packages apps scripts tests playground)
[ "${#CHANGED[@]}" -eq 1 ]
[ "${CHANGED[0]}" = "$DOC" ]
if git diff --name-only --diff-filter=ACMRT "$BASE_SHA"...HEAD -- packages apps scripts tests playground | grep -q .; then
  echo 'FAIL: 检出代码或测试运行逻辑变化'
  exit 1
fi
echo 'OK: attempt-run 说明文档与范围验收通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 使用说明 | `sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-usage-doc.test.ts` | 文档包含两个端点及远端 Bearer 鉴权的正反边界；角色白名单封闭且逐项等于九个生产角色；最小 payload 只要求三个字段并明确 base_sha 省略语义；派发失败回滚完整列出三个资源终态且不称为部分成功 | 文档尚不存在，4 个测试因 ENOENT 失败 |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- 实现基线固定使用 task bundle 的 `implementation_baseline.base_sha=565796b924487f6d5c4314703c757b32b788fdac`；不以角色 checkout 或 PRD 内陈旧 SHA 替换。

