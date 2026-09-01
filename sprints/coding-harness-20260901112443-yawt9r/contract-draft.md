# Sprint Contract Draft（Round 3）

## 权威基线与范围

- implementation baseline：`d4ae8c6d2b777f5762c4cd88a8e8d56004c66750`（本合同及后续角色不得以角色 checkout SHA 替换）
- 唯一产品交付物：`docs/current/attempt-run-bridge-guide.md`
- 禁止修改产品代码、配置或既有文档。
- Unified Map：`[MAP_NOT_CONFIGURED]`，没有 `must_run_assertions`；不回退到领域硬编码。
- contract-gate：适用（`packages/brain/src/lib/contract-gate.js` 存在）。
- gp-anchor: skipped (product-map.json not found)

## 文档章节与可操作性合同

最终说明页必须以四个可辨识的中文二级章节分别承载「端点与鉴权」「角色白名单」「payload 字段」「派发失败自动回滚」，不得只把关键词散落在示例或同一段落中。端点章节必须给出使用环境变量占位符的 POST 与 GET 调用示例；POST 示例必须同时展示 `sprint_dir`、`base_repo`、`branch`，并明确 `base_sha` 可省略且由生产 Brain 自解析。GET 示例必须说明其 `:id` 来自 POST 返回标识。示例不得包含真实 token，也不得把 loopback 免 token 的行为外推给宿主机或远端调用方。

## Response Schema（推导来源：N/A）

N/A — 本 Sprint 只新增使用说明，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试与历史输入）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → attempt-run 路由同时注册 `/attempt-run` 与 `/attempt-run/:attemptId`。
- `packages/brain/src/middleware/internal-auth.test.js` → `internalAuthOrLoopback` 区分 loopback 与非 loopback 请求，并在配置 token 后校验 Bearer token。
- `[累积FR]` 本 line 暂无历史。
- context-manifest：journey_id 为 `none`，无可查询的 line manifest。

## Golden Path

独立小路（无父路）

[读者打开中文说明] → [理解端点与鉴权] → [按白名单和 payload 构造请求] → [查询派发结果并识别失败回滚]

### Step 1：读者找到中文使用说明

**来源**：`[FROM_PRD]` — PRD「范围限定」及「预期受影响文件」。

**可观测行为**：`docs/current/attempt-run-bridge-guide.md` 是新增的中文文档，且是唯一产品交付变更。

**验证命令**：

```bash
git diff --name-only d4ae8c6d2b777f5762c4cd88a8e8d56004c66750...HEAD -- docs/current packages apps | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=s.trim().split(/\n/).filter(Boolean);if(JSON.stringify(a)!==JSON.stringify(["docs/current/attempt-run-bridge-guide.md"]))process.exit(1)})'
node -e 'const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)'
```

**硬阈值**：产品交付 diff 恰好 1 个文件，且正文至少含一个中文字符；以上两条命令均须 exit 0。

### Step 2：读者理解两个端点与鉴权

**来源**：`[FROM_PRD]` — PRD Golden Path 第 1、2 项。

**可观测行为**：文档分别说明 POST 创建并派发 attempt、GET 按 id 查询状态；说明两端点采用 `internalAuthOrLoopback`，宿主机/远端必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，且不展示真实 token。

**验证命令**：

```bash
node -e 'const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");for(const x of ["## 端点与鉴权","POST /api/brain/harness/attempt-run","创建","派发","GET /api/brain/harness/attempt-run/:id","查询","internalAuthOrLoopback","Authorization: Bearer $CECELIA_INTERNAL_TOKEN","宿主","远端"])if(!s.includes(x))throw new Error(x)'
```

**硬阈值**：上述 9 个语义锚点全部出现，命令 exit 0；文档不得包含 32 字符以上的 Bearer token 字面值。

### Step 3：读者按角色白名单与 payload 合同构造请求

**来源**：`[FROM_PRD]` — PRD Golden Path 第 3、4 项。

**可观测行为**：文档逐项列出九个角色白名单；明确 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略且由生产 Brain 自解析。

**验证命令**：

```bash
node -e 'const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");for(const x of ["## 角色白名单","## payload 字段","planner","proposer","critic","generator","generator-fix","evaluator","evaluator-fix","judge","reporter","sprint_dir","base_repo","branch","base_sha","可省略","生产 Brain","自解析"])if(!s.includes(x))throw new Error(x)'
```

**硬阈值**：九个 PRD 角色及七个 payload 语义锚点全部出现，命令 exit 0。

### Step 4：读者识别派发失败的完整回滚

**来源**：`[FROM_PRD]` — PRD Golden Path 第 5、6 项。

**可观测行为**：文档将派发失败说明为自动回滚，并同时呈现 `run → failed`、`session → closed`、`task → cancelled`。

**验证命令**：

```bash
node -e 'const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8").replace(/`/g,"").replace(/\s+/g," ");for(const r of [/## 派发失败自动回滚/,/自动回滚/,/run\s*(?:→|->)\s*failed/,/session\s*(?:→|->)\s*closed/,/task\s*(?:→|->)\s*cancelled/])if(!r.test(s))throw new Error(String(r))'
```

**硬阈值**：自动回滚及三对象终态必须同时命中，命令 exit 0。

## 禁 mock 边清单

（本单为纯文档新增，不修改调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 本 Sprint 只记录冻结 PRD 给出的调用合同，不改变设备/agent 到服务端的请求 shape。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本单不执行真实派发，仅验证文档内容；无真实世界接缝，N/A。）

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接使用说明，覆盖 PRD 指定四类信息。 |
| NFR（做得多好） | 内容可由确定性检查完整验证；不设性能、频控或版本阈值。 |
| Invariant（永不违反） | 不泄露 token；不修改代码、配置或既有文档；不把 `base_sha` 写成必填。 |
| 判定点（怎么知道） | 见下方；本任务无接缝判定点。 |
| 保质期（何时过期） | API 合同变化时由相关代码变更负责同步更新文档。 |
| 死亡告警（停了谁知道） | 冻结测试与 E2E 内容检查失败时 CI 立即报告。 |
| 失败语义（挂了怎么办） | 任一内容锚点缺失或范围越界即阻塞交付，不降级放行。 |
| 效果确认（已发≠已生效） | 通过读取最终文档并逐项断言四节内容与唯一产品 diff 来确认。 |

### 判定点登记表

（本任务无接缝判定点，N/A。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或内容不全 | 验收 exit 非 0，阻塞合并 | 是，补齐文档后可重跑 | 无降级 |
| 产品 diff 超出唯一允许文件 | 验收 exit 非 0，阻塞合并 | 是，清除越界变更后可重跑 | 无降级 |

### 输入对抗面

N/A — 不新增对外 agent 或外部可写接口。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例是否把缺少 `sprint_dir`、`base_repo` 或 `branch` 的请求误称为有效。
- 重复提交: 检查同一术语在各节是否出现互相矛盾的必填/可选说明。
- 中途中断: N/A，静态文档无运行中状态。
- 边界值: 检查角色恰好九项，且 `base_sha` 没被列为必填。
发现分级: P0/P1（泄密、错误鉴权或错误回滚合同）阻塞 merge；P2/P3 记录 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web（按冻结 PRD；本纯文档验收只使用仓库工作区）

```bash
#!/bin/bash
set -euo pipefail
DOC=docs/current/attempt-run-bridge-guide.md
BASE_SHA=d4ae8c6d2b777f5762c4cd88a8e8d56004c66750
test -f "$DOC"
node - "$DOC" <<'NODE'
const fs = require('fs');
const s = fs.readFileSync(process.argv[2], 'utf8');
const required = [
  '## 端点与鉴权', '## 角色白名单', '## payload 字段', '## 派发失败自动回滚',
  'POST /api/brain/harness/attempt-run', 'GET /api/brain/harness/attempt-run/:id',
  'internalAuthOrLoopback', 'Authorization: Bearer $CECELIA_INTERNAL_TOKEN',
  'planner', 'proposer', 'critic', 'generator', 'generator-fix',
  'evaluator', 'evaluator-fix', 'judge', 'reporter',
  'sprint_dir', 'base_repo', 'branch', 'base_sha', '可省略', '生产 Brain', '自解析',
];
for (const x of required) if (!s.includes(x)) throw new Error(`缺少: ${x}`);
if (!/[\u4e00-\u9fff]/.test(s)) throw new Error('正文不是中文');
if (/Authorization:\s*Bearer\s+(?!\$CECELIA_INTERNAL_TOKEN)[A-Za-z0-9_.-]{32,}/.test(s)) throw new Error('疑似真实 token');
const flat = s.replace(/`/g, '').replace(/\s+/g, ' ');
for (const r of [/自动回滚/, /run\s*(?:→|->)\s*failed/, /session\s*(?:→|->)\s*closed/, /task\s*(?:→|->)\s*cancelled/]) {
  if (!r.test(flat)) throw new Error(`缺少回滚语义: ${r}`);
}
NODE
CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD -- docs/current packages apps)
[ "$CHANGED" = "$DOC" ] || { echo "FAIL: 产品交付范围越界: $CHANGED"; exit 1; }
echo "OK: attempt-run 桥接使用说明合同通过"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 文档范围与中文正文 | `sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts` | `中文文档且位于唯一允许路径` | 文档尚不存在，读取时报 ENOENT |
| 端点与鉴权 | `sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts` | `两个端点用途与鉴权合同完整` | 文档尚不存在，测试失败 |
| 九项角色白名单 | `sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts` | `九项角色白名单逐项出现` | 文档尚不存在，测试失败 |
| payload 合同 | `sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts` | `payload 必填字段与 base_sha 省略语义` | 文档尚不存在，测试失败 |
| 失败回滚 | `sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts` | `派发失败三对象自动回滚状态完整` | 文档尚不存在，测试失败 |
