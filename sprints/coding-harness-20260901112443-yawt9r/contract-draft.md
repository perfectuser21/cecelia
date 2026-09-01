# Sprint Contract Draft (Round 1)

## Notes

- implementation baseline: `d4ae8c6d2b777f5762c4cd88a8e8d56004c66750`（冻结的实现基线；不以角色 checkout SHA 替换）
- `[MAP_NOT_CONFIGURED]`：task payload 未提供可用的 map_scope/map_repo 组合，`must_run_assertions` 为空。
- context-manifest: N/A（journey_id=none）。
- gp-anchor: skipped (product-map.json not found)
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)

## Response Schema（推导来源: PRD字面）

N/A — 本 Sprint 只新增使用说明，不新增或修改 HTTP 响应合同。文档必须按 PRD 字面描述两个既有端点，不推导额外 response key。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 角色白名单封闭且恰有九项；Router 同时挂载 `/attempt-run` 与 `/attempt-run/:attemptId`。
- `[累积FR]` 本 line 暂无历史。
- `[凭据安全]` 示例只能引用 `$CECELIA_INTERNAL_TOKEN`，不得出现真实 token。
- `[端点鉴权]` 两个端点均须描述为受 `internalAuthOrLoopback` 保护。
- `[禁止写死环境]` Bearer 值从环境变量读取，不写死宿主或远端环境值。
- `[Planner 分支]` N/A：本 Sprint 不修改 Planner 派发或分支行为。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-bridge-guide.md` 新增中文说明，覆盖端点用途、鉴权、九项角色、payload 与失败回滚。 |
| NFR（做得多好） | 一页中文文档；四个主题均可由冻结测试机械解析；不改代码。 |
| Invariant（永不违反） | 不泄露凭据、不把远端描述成免鉴权、不把 `base_sha` 描述为必填、不改产品代码。 |
| 判定点（怎么知道） | 见下方；本任务无真实世界状态推断。 |
| 保质期（何时过期） | 端点合同变化时由对应 API 维护者同步更新；本 Sprint 不设时间型过期。 |
| 死亡告警（停了谁知道） | 冻结 Vitest 与 E2E 内容断言在文档缺失或合同漂移时失败并阻塞 CI。 |
| 失败语义（挂了怎么办） | 任一主题缺失、白名单不精确或出现代码变更即验收失败，不降级放行。 |
| 效果确认（已发≠已生效） | 读取提交树中的目标文档并逐项断言内容与唯一交付路径。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或字段漂移 | 测试非零退出，阻塞合并 | 是，修正文档后可重跑 | 无降级 |
| 文档包含疑似真实 Bearer token | 测试非零退出，阻塞合并 | 是 | 无降级 |
| 交付 diff 含产品代码 | 测试非零退出，阻塞合并 | 是 | 无降级 |

### 输入对抗面

N/A — 本 Sprint 不新增对外 agent 或输入处理面。

## 真实调用方请求 shape

本 Sprint 仅记录 PRD 已冻结的调用合同：宿主机或远端调用两个端点时使用 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`；创建请求的 `payload` 必填 `sprint_dir`、`base_repo`、`branch`，`base_sha` 可省略并由生产 Brain 自解析。文档不新增或改变生产请求 shape。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A；纯文档交付不发起真实 attempt，以冻结内容断言验收。）

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期或 DB 写路径，N/A。）

## 接缝清单

（本单不改变真实系统接缝，N/A；文档准确性由冻结 PRD 的字面内容断言验收。）

## Golden Path

独立小路（无父路）

[阅读说明] → [按鉴权创建 attempt-run] → [按 id 查询] → [辨别派发或完整回滚]

### Step 1: 找到中文使用说明并识别两个端点用途
**来源**: `[FROM_PRD]` — thin_prd 第 1 项与 sprint-prd「Golden Path」第 1 项。

**可观测行为**: 读者在 `docs/current/attempt-run-bridge-guide.md` 看到中文标题，并能区分 POST 创建派发与 GET 按 id 查询用途。

**验证命令**:
```bash
DOC=docs/current/attempt-run-bridge-guide.md; test -f "$DOC"; grep -q '[一-龥]' "$DOC"; grep -Fq 'POST /api/brain/harness/attempt-run' "$DOC"; grep -Fq 'GET /api/brain/harness/attempt-run/:id' "$DOC"; grep -Eq '创建.*派发|派发.*创建' "$DOC"; grep -Eq '按.*id.*查询|查询.*状态' "$DOC"
```

**硬阈值**: 目标文件存在，含中文，两个端点及各自用途全部命中；上述命令 exit 0。

### Step 2: 采用正确鉴权方式
**来源**: `[FROM_PRD]` — thin_prd 第 1 项与 sprint-prd「Golden Path」第 2 项。

**可观测行为**: 读者知道两个端点使用 `internalAuthOrLoopback`，且宿主机/远端必须携带 Bearer 环境变量，不会复制真实 token。

**验证命令**:
```bash
DOC=docs/current/attempt-run-bridge-guide.md; grep -Fq 'internalAuthOrLoopback' "$DOC"; grep -Fq 'Authorization: Bearer $CECELIA_INTERNAL_TOKEN' "$DOC"; grep -Eq '宿主.*远端|远端.*宿主' "$DOC"; ! grep -Eq 'Bearer[[:space:]]+[A-Za-z0-9_-]{24,}' "$DOC"
```

**硬阈值**: 鉴权中间件、适用调用方和环境变量示例齐全，且无疑似硬编码 Bearer；上述命令 exit 0。

### Step 3: 按白名单与 payload 合同构造创建请求
**来源**: `[FROM_PRD]` — thin_prd 第 2、3 项与 sprint-prd「Golden Path」第 3、4 项。

**可观测行为**: 文档明确九项角色白名单：`planner`、`proposer`、`critic`、`generator`、`generator-fix`、`evaluator`、`evaluator-fix`、`judge`、`reporter`；同时把 `sprint_dir`、`base_repo`、`branch` 标为必填，把 `base_sha` 标为可省略且由生产 Brain 自解析。

**验证命令**:
```bash
node -e "const fs=require('fs');const s=fs.readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');const roles=['planner','proposer','critic','generator','generator-fix','evaluator','evaluator-fix','judge','reporter'];if(!roles.every(x=>s.includes('\`'+x+'\`')))process.exit(1);if(!['sprint_dir','base_repo','branch'].every(x=>new RegExp('(?:'+x+'.{0,40}必填|必填.{0,80}'+x+')','s').test(s)))process.exit(1);if(!/base_sha.{0,40}(可省略|可选)/s.test(s)||!/生产 Brain.{0,40}自解析/s.test(s))process.exit(1)"
```

**硬阈值**: 九项角色逐字命中且不缺项，三个字段均标必填，`base_sha` 省略语义完整；上述命令 exit 0。

### Step 4: 查询并辨别派发失败的完整回滚
**来源**: `[FROM_PRD]` — thin_prd 第 4 项与 sprint-prd「Golden Path」第 5、6 项。

**可观测行为**: 读者能用 GET 查询对应 id，并知道派发失败会同时收敛为 run→failed、session→closed、task→cancelled。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const [a,b] of [['run','failed'],['session','closed'],['task','cancelled']]){if(!new RegExp(a+'\\s*(?:→|->)\\s*'+b).test(s))process.exit(1)}if(!/派发失败.{0,160}自动回滚/s.test(s)&&!/自动回滚.{0,160}派发失败/s.test(s))process.exit(1)"
```

**硬阈值**: 三对象终态全部命中且明确属于派发失败自动回滚；上述命令 exit 0。

### Step 5: 保持纯文档范围
**来源**: `[AI_ADDED]` — 将 PRD「不修改任何代码」转为防越界的可执行 diff oracle。

**可观测行为**: 实现提交相对实现基线只新增指定说明页，不含代码、配置或既有文档改动。

**验证命令**:
```bash
BASE=d4ae8c6d2b777f5762c4cd88a8e8d56004c66750; test "$(git diff --name-only "$BASE"...HEAD -- docs/current | sort)" = 'docs/current/attempt-run-bridge-guide.md'; test -z "$(git diff --name-only "$BASE"...HEAD -- packages apps scripts .github)"
```

**硬阈值**: docs/current 交付 diff 恰为目标文件且代码路径 diff 为空；上述命令 exit 0。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web（本纯文档 Sprint 在仓库工作区执行 bash 内容与 diff 断言，不启动 UI）

```bash
#!/bin/bash
set -euo pipefail
BASE=d4ae8c6d2b777f5762c4cd88a8e8d56004c66750
DOC=docs/current/attempt-run-bridge-guide.md
test -f "$DOC"
grep -q '[一-龥]' "$DOC"
grep -Fq 'POST /api/brain/harness/attempt-run' "$DOC"
grep -Fq 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -Eq '创建.*派发|派发.*创建' "$DOC"
grep -Eq '按.*id.*查询|查询.*状态' "$DOC"
grep -Fq 'internalAuthOrLoopback' "$DOC"
grep -Fq 'Authorization: Bearer $CECELIA_INTERNAL_TOKEN' "$DOC"
grep -Eq '宿主.*远端|远端.*宿主' "$DOC"
! grep -Eq 'Bearer[[:space:]]+[A-Za-z0-9_-]{24,}' "$DOC"
node -e "const fs=require('fs');const s=fs.readFileSync(process.argv[1],'utf8');const roles=['planner','proposer','critic','generator','generator-fix','evaluator','evaluator-fix','judge','reporter'];if(!roles.every(x=>s.includes('\`'+x+'\`')))process.exit(1);if(!['sprint_dir','base_repo','branch'].every(x=>new RegExp('(?:'+x+'.{0,40}必填|必填.{0,80}'+x+')','s').test(s)))process.exit(1);if(!/base_sha.{0,40}(可省略|可选)/s.test(s)||!/生产 Brain.{0,40}自解析/s.test(s))process.exit(1);for(const [a,b] of [['run','failed'],['session','closed'],['task','cancelled']])if(!new RegExp(a+'\\s*(?:→|->)\\s*'+b).test(s))process.exit(1)" "$DOC"
test "$(git diff --name-only "$BASE"...HEAD -- docs/current | sort)" = 'docs/current/attempt-run-bridge-guide.md'
test -z "$(git diff --name-only "$BASE"...HEAD -- packages apps scripts .github)"
echo 'attempt-run 桥接使用说明合同验收通过'
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例是否会把缺少 `sprint_dir`、`base_repo` 或 `branch` 的请求误称为有效。
- 重复提交: 检查同一术语在各节的必填/可选口径是否矛盾。
- 中途中断: N/A（静态文档无执行中状态）。
- 边界值: 检查 `base_sha` 是否在任何表格或示例旁被误标为必填。
发现分级: P0/P1（凭据泄露、错误鉴权或错误回滚合同）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 使用说明完整性 | `sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts` | `说明两个端点的用途`; `说明宿主或远端 Bearer 鉴权`; `列出九项角色白名单`; `说明 payload 必填字段和 base_sha 省略语义`; `说明派发失败自动回滚三对象终态` | 目标文档尚不存在，5 个测试均失败 |
