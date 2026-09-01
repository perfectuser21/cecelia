# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面）

N/A — 本任务只新增使用说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → 角色白名单封闭为九项，且路由包含 POST `/attempt-run` 与 GET `/attempt-run/:attemptId`。
- [packages/brain/src/middleware/internal-auth.test.js] → `internalAuthOrLoopback` 区分 loopback 与远端鉴权。
- [MAP_NOT_CONFIGURED] task 未提供 map_scope/map_repo，无法取得 Unified Map radius；不回退到领域硬编码。
- context-manifest: unavailable（bundle 未提供 journey_id，无法构造 T3 端点）。

gp-anchor: skipped (product-map.json not found)

## Golden Path

独立小路（无父路）

[读者进入文档] → [理解端点与鉴权] → [选择合法角色并准备 payload] → [理解派发失败回滚结果]

### Step 1: 找到 attempt-run 桥接说明并理解两个端点

**来源**: `[FROM_PRD]` — thin PRD“POST ... 与 GET ... 两个端点的用途”。

**可观测行为**: `docs/current/attempt-run-bridge.md` 用中文分别解释 POST 异步派发与 GET 按 attempt id 轮询结果的用途。

**验证命令**:
```bash
node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge.md';const s=fs.readFileSync(p,'utf8');for(const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','异步派发','轮询'])if(!s.includes(x))throw Error('缺少 '+x)"
```

**硬阈值**: 文档存在、为中文，两个端点及各自用途均有明确说明；以上命令 exit 0。

### Step 2: 按调用位置选择正确鉴权

**来源**: `[FROM_PRD]` — thin PRD“鉴权方式（internalAuthOrLoopback，宿主/远端必须带 Bearer CECELIA_INTERNAL_TOKEN）”。

**可观测行为**: 读者能区分开发环境 loopback 与宿主/远端调用，并复制 Bearer header 写法。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge.md','utf8');for(const x of ['internalAuthOrLoopback','Authorization: Bearer $CECELIA_INTERNAL_TOKEN','宿主','远端'])if(!s.includes(x))throw Error('缺少 '+x)"
```

**硬阈值**: 四个鉴权关键信息全部出现；以上命令 exit 0。

### Step 3: 选择合法角色并构造最小 payload

**来源**: `[FROM_PRD]` — thin PRD“角色白名单九项”及“payload 必填字段”。

**可观测行为**: 文档逐项列出九个合法角色，并说明 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略且由生产 Brain 自解析。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge.md','utf8');for(const x of ['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge','sprint_dir','base_repo','branch','base_sha','生产 Brain','可省略'])if(!s.includes(x))throw Error('缺少 '+x)"
```

**硬阈值**: 九个角色恰与生产 `ALLOWED_ROLES` 一致，四个 payload 字段的必填/省略语义准确；以上命令 exit 0。

### Step 4: 识别派发失败后的自动回滚终态

**来源**: `[FROM_PRD]` — thin PRD“派发失败自动回滚的行为（run→failed/session→closed/task→cancelled）”。

**可观测行为**: 文档明确写出三类桥接资源的回滚终态，避免调用方误判为仍在执行。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge.md','utf8').replace(/\s/g,'');for(const x of ['run→failed','session→closed','task→cancelled'])if(!s.includes(x))throw Error('缺少 '+x)"
```

**硬阈值**: 三条状态迁移均完整出现；以上命令 exit 0。

## 真实调用方请求 shape

N/A — 本 Sprint 只记录现有接口用法，不改设备/agent 到服务端的请求 shape。文档示例仍须使用生产鉴权 header `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，payload 字段按 PRD 字面值书写。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本单不改变真实系统接缝，只文档化已存在接口，N/A。）

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|---|---|---|
| FR（做什么） | 功能需求 | 在 `docs/current/` 新增 attempt-run 中文使用说明，覆盖 PRD 四节 |
| NFR（做得多好） | 非功能需求 | 内容可由冻结 Vitest 与 E2E 脚本确定性解析；不改代码 |
| Invariant（永不违反） | 不变量 | 不泄露 token 值；不把远端调用写成免鉴权；不修改生产代码 |
| 判定点（怎么知道） | 模糊现实判断 | 本任务无接缝判定点，见下表 |
| 保质期（何时过期） | 退役条件 | 当端点、白名单、鉴权或 payload 契约变化时由对应代码变更同步更新文档与测试 |
| 死亡告警（停了谁知道） | 停止工作告警 | 冻结测试在 Sprint Tests/CI 中失败并阻塞合并 |
| 失败语义（挂了怎么办） | 故障策略 | 文档缺任一必需信息即测试失败，不允许降级放行 |
| 效果确认（已发≠已生效） | 生效回执 | 读取实际文档并逐项解析四节内容，测试 exit 0 才算交付 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档不存在或缺节 | 测试非零退出并阻塞合并 | 是 | 无降级 |
| 白名单或字段语义漂移 | 测试非零退出并要求文档与生产事实重新对齐 | 是 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入入口。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例是否清楚说明非法 role 会被拒绝。
- 重复提交: 检查文档是否误导读者把同一派发重复提交当作轮询。
- 中途中断: 检查 POST 已返回 attempt_id 后，GET 轮询说明是否可独立理解。
- 边界值: 检查 `base_sha` 省略与显式提供两种表述是否无歧义。
发现分级: P0/P1（泄露凭据或错误鉴权说明）阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
DOC='docs/current/attempt-run-bridge.md'
test -s "$DOC"
node - <<'NODE'
const fs = require('fs');
const doc = fs.readFileSync('docs/current/attempt-run-bridge.md', 'utf8');
const required = [
  'POST /api/brain/harness/attempt-run', 'GET /api/brain/harness/attempt-run/:id',
  'internalAuthOrLoopback', 'Authorization: Bearer $CECELIA_INTERNAL_TOKEN',
  'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
  'evaluator', 'evaluator-evidence-repair', 'judge',
  'sprint_dir', 'base_repo', 'branch', 'base_sha', '生产 Brain', '可省略',
  'run → failed', 'session → closed', 'task → cancelled',
];
for (const value of required) {
  if (!doc.includes(value)) throw new Error(`文档缺少: ${value}`);
}
if (!/[\u4e00-\u9fff]/.test(doc)) throw new Error('文档不是中文');
NODE
git diff --name-only 46221f91778af50e1be078f1e542ec5c17360126...HEAD | grep -v '^sprints/coding-harness-20260901035935-jlojco/' | grep -qx 'docs/current/attempt-run-bridge.md'
echo 'OK: attempt-run 桥接说明满足四节合同且未修改代码'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明四节 | `sprints/coding-harness-20260901035935-jlojco/tests/attempt-run-bridge-doc.test.ts` | `说明 POST 与 GET 用途`; `说明 internalAuthOrLoopback 与远端 Bearer 鉴权`; `列出九项角色白名单`; `说明 payload 必填字段与 base_sha 省略`; `说明派发失败自动回滚终态`; `只新增约定文档且不改代码` | 文档尚不存在，至少 6 个测试失败 |

## Notes

- implementation baseline: `46221f91778af50e1be078f1e542ec5c17360126`（固定，不被 role checkout SHA 替换）。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)。
- staging 预览闸: N/A（journey_type=dev_pipeline）。
