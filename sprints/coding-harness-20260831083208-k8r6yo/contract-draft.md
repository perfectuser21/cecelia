# Sprint Contract Draft（Round 1）— attempt-run 桥接使用说明

## 范围与基线

- 实现基线：`perfectuser21/cecelia@5c12d2af68e2b2e4b8dcaaa2c87e50efab743291`。
- 唯一实现产物：`docs/current/attempt-run-bridge-guide.md`。
- 不修改 `packages/`、`apps/`、`scripts/`、工作流或其他应用代码。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- gp-anchor: skipped (product-map.json not found)
- Unified Map: `[MAP_NOT_CONFIGURED]`；无 `must_run_assertions` 注入。

## Response Schema（推导来源: N/A）

N/A — 本任务只新增说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [`packages/brain/src/routes/__tests__/harness-attempt-run.test.js`] → 角色白名单封闭，包含九个角色且不包含 commander/publisher。
- [`packages/brain/src/middleware/internal-auth.test.js`] → `internalAuthOrLoopback` 对远端请求执行内部 token 鉴权。
- context-manifest: unavailable（输入未提供 journey_id，无法形成有效查询）。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增中文说明页，准确说明两个端点、鉴权、九角色、payload 字段及失败回滚。 |
| NFR（做得多好） | 内容可由冻结 Vitest 与单条 E2E 脚本确定性解析；九角色逐项命中。 |
| Invariant（永不违反） | 仅文档变更；不得把 token 字面值或业务凭据写入仓库。 |
| 判定点（怎么知道） | 以实现基线中的路由和中间件源码为事实源，见下表。 |
| 保质期（何时过期） | 端点、白名单、鉴权或回滚实现变化时，由对应代码变更同步更新本文。 |
| 死亡告警（停了谁知道） | 冻结测试在 Sprint Tests/CI 中失败并阻塞合并。 |
| 失败语义（挂了怎么办） | 任一必备章节或字面事实缺失即验收失败，不允许降级放行。 |
| 效果确认（已发≠已生效） | 读取最终提交中的说明页，逐项解析并核对所有事实。 |

### 判定点登记表

（本任务无真实世界接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或必备事实缺失 | 测试返回非零并阻塞合并 | 是，补全文档后可重跑 | 无降级 |
| 文档修改应用代码 | 变更范围检查返回非零并阻塞合并 | 是，撤出越界变更后可重跑 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或可写接口。

## Golden Path

独立小路（无父路）

[读者打开说明页] → [理解端点与鉴权] → [按白名单和 payload 派发] → [理解失败回滚结果]

### Step 1：找到 attempt-run 桥接入口
**来源**: `[FROM_PRD]` — PRD“必须覆盖”第 1 项。

**可观测行为**: 中文说明页明确列出 `POST /api/brain/harness/attempt-run` 用于异步派发并返回 202，以及 `GET /api/brain/harness/attempt-run/:id` 用于轮询结构化 attempt 结果。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','202','轮询'])if(!s.includes(x))process.exit(1)"`

**硬阈值**: 两个端点、异步 202 与轮询用途全部出现；对应验证命令 exit 0。

### Step 2：采用正确鉴权
**来源**: `[FROM_PRD]` — PRD“必须覆盖”第 2 项。

**可观测行为**: 文档说明路由使用 `internalAuthOrLoopback`，并给出宿主/远端携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN` 的示例；不包含 token 实值。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['internalAuthOrLoopback','Authorization: Bearer $CECELIA_INTERNAL_TOKEN','宿主','远端'])if(!s.includes(x))process.exit(1)"`

**硬阈值**: 鉴权名、两类调用来源与 Bearer 环境变量示例全部出现；对应验证命令 exit 0。

### Step 3：构造合法派发请求
**来源**: `[FROM_PRD]` — PRD“必须覆盖”第 3、4 项。

**可观测行为**: 文档逐字列出九个允许角色，并说明 `payload.sprint_dir`、`payload.base_repo`、`payload.branch` 必填，`payload.base_sha` 可省略且由生产 Brain 自解析。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge','payload.sprint_dir','payload.base_repo','payload.branch','payload.base_sha','生产 Brain','可省略'])if(!s.includes(x))process.exit(1)"`

**硬阈值**: 九个角色恰有完整清单，四个 payload 字段及 base_sha 省略语义明确；对应验证命令 exit 0。

### Step 4：识别派发失败后的状态
**来源**: `[FROM_PRD]` — PRD“必须覆盖”第 5 项。

**可观测行为**: 文档明确派发抛错或未返回 `LAUNCHED` 时自动回滚为 run → `failed`、session → `closed`、task → `cancelled`。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['派发失败','run','failed','session','closed','task','cancelled'])if(!s.includes(x))process.exit(1)"`

**硬阈值**: 三个资源与三个终态一一出现；对应验证命令 exit 0。

## 真实调用方请求 shape

N/A — 本任务只记录现有内部 API 的调用说明，不修改设备/agent 到服务端的生产请求形态。文档示例仍必须使用现有 Bearer header 与 `application/json`。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 接缝清单

（本单不改变真实运行接缝，N/A）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 核对说明页没有把 `base_sha` 错写成必填。
- 重复提交: 核对九角色没有重复项或遗漏项。
- 中途中断: N/A，静态文档无执行中状态。
- 边界值: 核对 `generator-fix` 与 `evaluator-evidence-repair` 的连字符完整。
发现分级: P0/P1（错误鉴权或错误字段会阻断调用）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## E2E 验收

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
DOC=docs/current/attempt-run-bridge-guide.md
test -f "$DOC"
node - "$DOC" <<'NODE'
const fs = require('fs');
const text = fs.readFileSync(process.argv[2], 'utf8');
const sections = ['端点用途', '鉴权方式', '角色白名单', 'payload 字段', '派发失败自动回滚'];
const facts = [
  'POST /api/brain/harness/attempt-run', 'GET /api/brain/harness/attempt-run/:id',
  'internalAuthOrLoopback', 'Authorization: Bearer $CECELIA_INTERNAL_TOKEN',
  'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
  'evaluator', 'evaluator-evidence-repair', 'judge',
  'payload.sprint_dir', 'payload.base_repo', 'payload.branch', 'payload.base_sha',
  'failed', 'closed', 'cancelled'
];
for (const value of [...sections, ...facts]) {
  if (!text.includes(value)) throw new Error(`文档缺少: ${value}`);
}
if (!/base_sha[\s\S]{0,80}可省略[\s\S]{0,80}生产 Brain/.test(text)) {
  throw new Error('base_sha 省略与生产 Brain 自解析语义不完整');
}
if (!/run[^\n]*failed/.test(text) || !/session[^\n]*closed/.test(text) || !/task[^\n]*cancelled/.test(text)) {
  throw new Error('失败回滚映射不完整');
}
NODE
git diff --name-only 5c12d2af68e2b2e4b8dcaaa2c87e50efab743291...HEAD | awk '!/^docs\/current\/attempt-run-bridge-guide\.md$/ && !/^sprints\/coding-harness-20260831083208-k8r6yo\// {print; bad=1} END {exit bad+0}'
```

**通过标准**: 脚本 exit 0；文档事实全部命中，且实现范围没有应用代码变更。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明完整性 | `sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-guide.test.ts` | `两个端点用途与鉴权说明完整`；`九项角色白名单完整且没有越权角色`；`payload 必填字段与 base_sha 省略语义完整`；`派发失败自动回滚映射完整` | 实现文档尚不存在，4 个 it() 均因 ENOENT 失败 |

## Notes

- 本合同不固化当前 Proposer 的 attempt/capability identity；未来执行身份由 Runner 的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID` 注入。
- 当前任务无铁律清单输入，故无可映射的 INV 条目。
