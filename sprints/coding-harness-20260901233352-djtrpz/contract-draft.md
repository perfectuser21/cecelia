# Sprint Contract Draft (Round 1)

## 证据来源与基线

- 权威实现基线：`37fc357d927b1429de59e1b50e4de762c5e7ea18`（来自 `inputs.implementation_baseline.base_sha`；不得以角色 checkout 之外的 SHA 替换）。
- 事实源：`packages/brain/src/routes/harness-attempt-run.js` 的 `ALLOWED_ROLES`、路由鉴权与 rollback；`tests/gp/f1/step3-attempt-run-endpoint.test.js` 的既有回归约束。
- Unified Map：`[MAP_NOT_CONFIGURED]`，task payload 的 `map_scope`/`map_repo` 未形成可查询 scope/repo；`must_run_assertions=[]`。
- 累积 FR：PRD 明示“本 line 暂无历史”。
- contract-gate：启用（`packages/brain/src/lib/contract-gate.js` 存在）。
- gp-anchor：skipped (`product-map.json` not found)。

## Response Schema（推导来源: PRD 字面）

N/A — 任务仅新增说明文档，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试）

- `tests/gp/f1/step3-attempt-run-endpoint.test.js` → 角色不在白名单返回 400；缺 title/sprint_dir 返回 400。
- `tests/gp/f1/step3-attempt-run-endpoint.test.js` → dispatch 未 LAUNCHED 时回滚 run、session、task 锚。
- `tests/gp/f1/step3-attempt-run-endpoint.test.js` → GET 返回结构化 attempt 结果。
- `[累积FR]` 本 line 暂无历史。

## Golden Path

独立小路（无父路）

[读者打开说明] → [理解创建与查询] → [核对鉴权、角色与 payload] → [理解失败回滚]

### Step 1: 找到唯一新增的中文说明
**来源**: `[FROM_PRD]` — PRD“范围限定”和 E2E 验收第 1、2 项。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 是实现交付中唯一新增的非 sprint 文件，且正文含中文。

**验证命令**:
```bash
node -e "const{execFileSync}=require('child_process'),fs=require('fs');const b='37fc357d927b1429de59e1b50e4de762c5e7ea18';const lines=execFileSync('git',['diff','--name-status',b+'...HEAD'],{encoding:'utf8'}).trim().split(/\n/).filter(x=>x&&!x.includes('sprints/coding-harness-20260901233352-djtrpz/'));if(lines.length!==1||lines[0]!=='A\tdocs/current/attempt-run-bridge-guide.md')process.exit(1);if(!/[\u4e00-\u9fff]/.test(fs.readFileSync('docs/current/attempt-run-bridge-guide.md','utf8')))process.exit(1)"
```

**硬阈值**: 非 sprint diff 恰为 `A docs/current/attempt-run-bridge-guide.md` 一行；中文字符至少一个。上方命令 exit 0。

### Step 2: 理解两个端点与鉴权边界
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1、2 项与“边界情况”。

**可观测行为**: 文档区分 POST 创建、GET 查询；说明 loopback 与宿主/远端鉴权差异，远端必须携带 Bearer token 变量名且不披露值。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','internalAuthOrLoopback','Bearer CECELIA_INTERNAL_TOKEN'])if(!s.includes(x))process.exit(1);if(/CECELIA_INTERNAL_TOKEN\s*=\s*[^$<{\s][^\s]*/.test(s))process.exit(1)"
```

**硬阈值**: 四个合同字面全部出现，且不存在 token 赋值字面；上方命令 exit 0。

### Step 3: 核对角色与 payload
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3、4 项。

**可观测行为**: 角色节按服务端顺序列出且仅列九项；payload 节把 `sprint_dir`、`base_repo`、`branch` 标为必填，把 `base_sha` 标为可省略并由生产 Brain 自解析。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260901233352-djtrpz/tests/attempt-run-bridge-guide.test.ts
```

**硬阈值**: 4 tests 全部通过；角色数组与基线事实源逐项相等。

### Step 4: 理解派发失败后的闭环
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 项。

**可观测行为**: 失败回滚节同时写明 `run→failed`、`session→closed`、`task→cancelled`。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['run→failed','session→closed','task→cancelled'])if(!s.includes(x))process.exit(1)"
```

**硬阈值**: 三个终态字面全部出现；上方命令 exit 0。

## 禁 mock 边清单

（本单纯文档改动，不改调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 本单只记录既有端点使用方式，不新增或修改设备/agent 请求 shape。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本单只验证版本库中的文档内容与 diff，不触碰真机、第三方 API、异步消息或生产 DB，N/A。）

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页 attempt-run 桥接中文说明，覆盖 PRD 四类内容。 |
| NFR（做得多好） | 九项角色完整、字段语义准确、无真实 token、仅一个非 sprint 新增文档。 |
| Invariant（永不违反） | 不改代码/既有文档；实现基线固定来自 task payload；凭据不入库。 |
| 判定点（怎么知道） | 见下方；本任务无接缝判定点。 |
| 保质期（何时过期） | 服务端白名单、鉴权或 payload 合同变化时，由对应代码变更同步更新文档。 |
| 死亡告警（停了谁知道） | 冻结 Vitest 与 E2E 静态 oracle 在 required CI 失败并阻塞合并。 |
| 失败语义（挂了怎么办） | 任一内容或范围断言失败即 fail-closed，禁止交付。 |
| 效果确认（已发≠已生效） | 以候选 HEAD 中文档内容及相对权威基线的 canonical diff 为准。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节、名单漂移或范围越界 | 验收命令非零退出并阻塞合并 | 是，修正文档后重跑 | 无降级，不接受部分覆盖 |

### 输入对抗面

N/A — 不新增对外 agent 或可写接口。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误把未知角色写入白名单。
- 重复提交: 检查同一字段是否在不同章节出现相互矛盾的必填性描述。
- 中途中断: N/A，纯静态文档。
- 边界值: 检查 `base_sha` 是否被误写为必填或固定为角色 checkout SHA。
发现分级: P0/P1（泄露凭据、范围越界或关键合同错误）阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA='37fc357d927b1429de59e1b50e4de762c5e7ea18'
SPRINT_DIR='sprints/coding-harness-20260901233352-djtrpz'
GUIDE='docs/current/attempt-run-bridge-guide.md'
test -f "$GUIDE"
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts"
node -e "const{execFileSync}=require('child_process');const lines=execFileSync('git',['diff','--name-status',process.argv[1]+'...HEAD'],{encoding:'utf8'}).trim().split(/\n/).filter(x=>x&&!x.includes(process.argv[2]+'/'));if(lines.length!==1||lines[0]!=='A\tdocs/current/attempt-run-bridge-guide.md'){console.error(lines);process.exit(1)}" "$BASE_SHA" "$SPRINT_DIR"
node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');if(!s.includes('task_request_hash: 239fe1b9cb13af9ee1c12171b0671dd016272a07bf59ddfda51e786809fc5946'))process.exit(1);if(/CECELIA_INTERNAL_TOKEN\s*=\s*[^$<{\s][^\s]*/.test(s))process.exit(1)" "$GUIDE"
echo 'Golden Path 文档验收通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 说明完整性 | `sprints/coding-harness-20260901233352-djtrpz/tests/attempt-run-bridge-guide.test.ts` | `文档包含两个端点用途与远端鉴权约束`；`文档逐项列出恰好九项角色白名单`；`文档区分 payload 必填字段与可省略 base_sha`；`文档完整说明派发失败自动回滚的三个终态` | 文档尚不存在，4 tests 因 `ENOENT` 失败 |
